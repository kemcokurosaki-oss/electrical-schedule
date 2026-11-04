// ─── 議事録（電気工程会議） ─────────────────────────────
// 会議日ごとに「全体の決定事項」＋「工番の機械ごとの欄」（機械が合わない工程がある工番は「工番共通」の欄も）。
// 本文は書式付き（黒・赤・青・取り消し線）。会議を始めると、前回の内容を色や取り消し線ごと全部引き継ぐ。
// denki_meetings（会議日・決定事項・会議の開始/終了）／denki_meeting_notes（工番＋機械ごとの欄。machine='' は工番共通）
let minutesList = [];          // [{ id, meeting_date, started_at, ended_at }] 新しい順
let minutesSelectedDate = null;
let minutesLoaded = false;
const minutesCache = {};       // 会議 id → { decisions, notes: { '工番|機械': 本文 } }
let dockKey = '__all';         // 下の議事録欄で表示しているページ（'__all' か工番）
let dockMachine = null;        // 工番のページで表示している機械（'' は工番共通）
let dockOpen = false;
const pendingSaves = new Set(); // 保存中の処理（会議を始める前に待つ）

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtMeetingDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

function todayStr() {
  return toDBDate(new Date());
}

async function currentEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || null;
}

function minutesError(e) {
  console.warn('議事録の保存エラー:', e);
  alert(`保存できませんでした。入力した内容は画面に残っています。\n${e.message || e}\n\nログインが切れている場合は、入力内容を控えてからページを再読み込みしてください。`);
}

function splitKey(key) {
  const i = key.indexOf('|');
  return [key.slice(0, i), key.slice(i + 1)];
}

// ─── 読み込み ─────────────────────────────────────────
async function loadMinutesList() {
  let res = await sb.from('denki_meetings').select('id, meeting_date, started_at, ended_at').order('meeting_date', { ascending: false });
  if (res.error) {
    console.warn('会議の開始・終了を読めませんでした（DB変更の SQL を実行してください）', res.error);
    res = await sb.from('denki_meetings').select('id, meeting_date').order('meeting_date', { ascending: false });
  }
  if (res.error) { console.warn('議事録の一覧を読み込めませんでした', res.error); minutesList = []; return false; }
  minutesList = res.data;
  return true;
}

function meetingByDate(dateStr) {
  return minutesList.find(m => m.meeting_date === dateStr) || null;
}

// 会議中: 今日の議事録で、開始していて終了していないもの
function activeMeeting() {
  const m = meetingByDate(todayStr());
  return m && m.started_at && !m.ended_at ? m : null;
}

// 下の議事録欄に出す回: 今日の議事録があればそれ、無ければ一番新しい回
function dockMeeting() {
  return meetingByDate(todayStr()) || minutesList[0] || null;
}

async function loadMeetingData(meeting) {
  if (minutesCache[meeting.id]) return minutesCache[meeting.id];
  const [mRes, nRes] = await Promise.all([
    sb.from('denki_meetings').select('decisions').eq('id', meeting.id).single(),
    sb.from('denki_meeting_notes').select('project_number, machine, body').eq('meeting_id', meeting.id),
  ]);
  if (mRes.error || nRes.error) throw (mRes.error || nRes.error);
  const notes = {};
  nRes.data.forEach(n => { notes[`${n.project_number}|${n.machine || ''}`] = n.body; });
  return (minutesCache[meeting.id] = { decisions: mRes.data.decisions, notes });
}

function getBody(data, key) {
  return key === '__all' ? data.decisions : data.notes[key];
}

// 欄の一覧: 表示中の工番の機械ごと＋（機械が合わない工程がある工番は）工番共通＋この回に記入がある欄
function noteGroups(data) {
  const groups = [], byPn = {};
  const group = (pn, customer) => {
    if (!byPn[pn]) { byPn[pn] = { pn, customer: customer || '', slots: [] }; groups.push(byPn[pn]); }
    return byPn[pn];
  };
  const addSlot = (g, machine) => {
    const key = `${g.pn}|${machine}`;
    if (!g.slots.some(s => s.key === key)) g.slots.push({ key, machine, title: machine || '工番共通' });
  };
  currentProjects.forEach(p => addSlot(group(p.project_number, p.customer_name), p.machine || ''));
  groups.forEach(g => { if ((ganttOther[g.pn] || []).length) addSlot(g, ''); });
  Object.keys(data ? data.notes : {}).forEach(k => { const [pn, machine] = splitKey(k); addSlot(group(pn), machine); });
  groups.forEach(g => g.slots.sort((a, b) => (a.machine === '') - (b.machine === '')));
  return groups;
}

// ─── 書式付きの入力欄 ─────────────────────────────────
function createEditor(meeting, key, body) {
  const html = richFromStored(body);
  if (!canEdit) {
    const v = document.createElement('div');
    v.className = 'rt-view';
    v.innerHTML = html || '<span class="rt-empty">記入なし</span>';
    return v;
  }
  const ed = document.createElement('div');
  ed.className = 'rt-editor';
  ed.contentEditable = 'true';
  ed.innerHTML = html;
  let saved = ed.innerHTML;
  ed.addEventListener('input', () => ed.classList.toggle('dirty', ed.innerHTML !== saved));
  ed.addEventListener('blur', () => {
    if (ed.innerHTML === saved) return;
    const current = ed.innerHTML;
    const clean = sanitizeRich(current);
    const p = saveBody(meeting.id, key, isBlankRich(clean) ? null : clean).then(ok => {
      if (ok) { saved = current; ed.classList.toggle('dirty', ed.innerHTML !== saved); }
    }).finally(() => pendingSaves.delete(p));
    pendingSaves.add(p);
  });
  return ed;
}

// 書式のボタン（文字を選んでから押す）
const RT_COLORS = [['黒', '#2a2f35'], ['赤', '#c03030'], ['青', '#1f5fa8']];
function createRichToolbar() {
  const bar = document.createElement('div');
  bar.className = 'rt-tools';
  const run = (c, v) => {
    try { document.execCommand('styleWithCSS', false, true); } catch (_) { /* 古いブラウザ */ }
    document.execCommand(c, false, v);
    const ed = document.activeElement;
    if (ed && ed.classList.contains('rt-editor')) ed.dispatchEvent(new Event('input'));
  };
  const button = (cls, title, onDown) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rt-btn ' + cls;
    b.title = title;
    b.addEventListener('mousedown', e => { e.preventDefault(); onDown(e); }); // 入力欄の選択を外さない
    return b;
  };

  // 文字の色（Excel と同じ「A に色の線」のボタン。押すと色を選べる）
  const wrap = document.createElement('span');
  wrap.className = 'rt-color';
  const pop = document.createElement('div');
  pop.className = 'rt-color-pop';
  pop.hidden = true;
  const close = e => { if (!wrap.contains(e.target)) { pop.hidden = true; document.removeEventListener('mousedown', close); } };
  const colorBtn = button('color', '文字の色', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) document.addEventListener('mousedown', close);
    else document.removeEventListener('mousedown', close);
  });
  colorBtn.innerHTML = '<span class="rt-a">A</span><span class="rt-a-bar"></span><span class="rt-caret">▾</span>';
  RT_COLORS.forEach(([label, color]) => {
    const item = button('rt-color-item', label, () => {
      run('foreColor', color);
      pop.hidden = true;
      document.removeEventListener('mousedown', close);
    });
    item.innerHTML = '<span class="rt-swatch"></span><span></span>';
    item.firstChild.style.background = color;
    item.lastChild.textContent = label;
    pop.appendChild(item);
  });
  wrap.appendChild(colorBtn);
  wrap.appendChild(pop);
  bar.appendChild(wrap);

  const strike = button('strike', '取り消し線（もう一度押すと解除）', () => run('strikeThrough'));
  strike.textContent = 'abc';
  bar.appendChild(strike);
  const clear = button('clear', '色と取り消し線を外す', () => run('removeFormat'));
  clear.textContent = '書式解除';
  bar.appendChild(clear);
  return bar;
}

// 入力欄から離れた直後の保存が終わるのを待つ
async function flushEditors() {
  if (document.activeElement && document.activeElement.classList.contains('rt-editor')) document.activeElement.blur();
  await Promise.all([...pendingSaves]);
}

// ─── 議事録の画面 ─────────────────────────────────────
async function showMinutes() {
  document.getElementById('minutes-new').style.display = canEdit ? '' : 'none';
  if (!minutesLoaded) {
    minutesLoaded = true;
    selectMinutes(dockMeeting()?.meeting_date || todayStr());
  } else {
    selectMinutes(minutesSelectedDate);
  }
}

function renderMinutesList() {
  const list = document.getElementById('minutes-list');
  list.innerHTML = '';
  if (minutesList.length === 0) {
    list.textContent = '議事録はまだありません';
    return;
  }
  let curMonth = null;
  minutesList.forEach(m => {
    const month = m.meeting_date.slice(0, 7);
    if (month !== curMonth) {
      curMonth = month;
      const h = document.createElement('div');
      h.className = 'minutes-month';
      h.textContent = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
      list.appendChild(h);
    }
    const b = document.createElement('button');
    b.className = 'minutes-date-btn' + (m.meeting_date === minutesSelectedDate ? ' active' : '');
    b.textContent = fmtMeetingDate(m.meeting_date);
    b.addEventListener('click', () => selectMinutes(m.meeting_date));
    list.appendChild(b);
  });
}

async function selectMinutes(dateStr) {
  minutesSelectedDate = dateStr;
  document.getElementById('minutes-date').value = dateStr;
  renderMinutesList();

  const main = document.getElementById('minutes-main');
  const meeting = meetingByDate(dateStr);
  if (!meeting) {
    main.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'minutes-empty';
    p.textContent = `${fmtMeetingDate(dateStr)} の議事録はありません`;
    main.appendChild(p);
    if (canEdit) {
      const b = document.createElement('button');
      b.className = 'btn btn-dark minutes-create-btn';
      b.textContent = 'この日の議事録を作成（前回の内容を引き継ぎます）';
      b.addEventListener('click', async () => {
        await flushEditors();
        if (await createMinutes(dateStr)) { selectMinutes(dateStr); renderMeetingState(); renderDock(); }
      });
      main.appendChild(b);
    }
    return;
  }

  main.textContent = '読み込み中...';
  let data;
  try { data = await loadMeetingData(meeting); }
  catch (e) { main.textContent = '議事録を読み込めませんでした: ' + (e.message || e); return; }
  if (minutesSelectedDate !== dateStr) return; // 読み込み中に別の日を選んだ
  renderMinutesMain(meeting, data);
}

function richLegend() {
  const s = document.createElement('span');
  s.className = 'rich-legend';
  s.innerHTML = '<span>黒＝前回のまま</span><span class="red">赤＝訂正</span><span class="blue">青＝追記</span>';
  return s;
}

function renderMinutesMain(meeting, data) {
  const main = document.getElementById('minutes-main');
  main.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'minutes-head';
  const h2 = document.createElement('h2');
  h2.textContent = `${fmtMeetingDate(meeting.meeting_date)}　電気工程会議`;
  head.appendChild(h2);
  head.appendChild(richLegend());
  const right = document.createElement('div');
  right.className = 'minutes-head-right';
  const pr = document.createElement('button');
  pr.className = 'btn';
  pr.textContent = '印刷・PDF';
  pr.addEventListener('click', async () => { await flushEditors(); openPrint(meeting); });
  right.appendChild(pr);
  if (canEdit) {
    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.textContent = 'この議事録を削除';
    del.addEventListener('click', () => deleteMinutes(meeting));
    right.appendChild(del);
  }
  head.appendChild(right);
  main.appendChild(head);

  if (canEdit) {
    const tools = createRichToolbar();
    tools.classList.add('mn-tools');
    main.appendChild(tools);
  }

  const card = (pn, customer, slots) => {
    const c = document.createElement('div');
    c.className = 'mn-card';
    const h = document.createElement('div');
    h.className = 'mn-card-head';
    h.innerHTML = '<b></b><span></span>';
    h.querySelector('b').textContent = pn;
    h.querySelector('span').textContent = customer || '';
    c.appendChild(h);
    slots.forEach(s => {
      const row = document.createElement('div');
      row.className = 'mn-row';
      const t = document.createElement('div');
      t.className = 'mn-row-title';
      t.textContent = s.title;
      const b = document.createElement('div');
      b.className = 'mn-row-body';
      b.appendChild(createEditor(meeting, s.key, getBody(data, s.key)));
      row.appendChild(t); row.appendChild(b);
      c.appendChild(row);
    });
    return c;
  };
  main.appendChild(card('全体', '', [{ key: '__all', title: '決定事項' }]));
  noteGroups(data).forEach(g => main.appendChild(card(g.pn, g.customer, g.slots)));
}

// ─── 下の議事録欄（ガントの画面） ─────────────────────
function setDockOpen(open) {
  dockOpen = open;
  document.getElementById('min-dock').classList.toggle('open', open);
  const tg = document.getElementById('dock-toggle');
  tg.textContent = open ? '▼' : '▲';
  tg.title = open ? '畳む' : '開く';
  renderDock();
  setTimeout(resizeGantt, 0);
}
document.getElementById('dock-toggle').addEventListener('click', () => setDockOpen(!dockOpen));

// ガントで選んだ行の工番・機械に切り替える（machine='' は工番共通、省略は工番の最初の機械）
function setDockKey(pn, machine) {
  const page = pn || '__all';
  const m = machine === undefined || machine === null ? null : machine;
  if (page === dockKey && (m === null || m === dockMachine)) return; // 同じ欄なら作り直さない（入力中の欄を消さない）
  dockKey = page;
  dockMachine = m;
  renderDock();
}

async function renderDock() {
  const tabs = document.getElementById('dock-tabs');
  const mTabs = document.getElementById('dock-machines');
  const body = document.getElementById('dock-body');
  const meeting = dockMeeting();
  if (!meeting) {
    tabs.innerHTML = '';
    mTabs.innerHTML = '';
    mTabs.hidden = true;
    body.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'dock-empty';
    p.textContent = canEdit ? '議事録はまだありません。上の「会議を始める」で今日の議事録を作成します。' : '議事録はまだありません。';
    body.appendChild(p);
    return;
  }
  let data;
  try { data = await loadMeetingData(meeting); }
  catch (e) { body.textContent = '議事録を読み込めませんでした: ' + (e.message || e); return; }

  // タブは「全体」と工番ごと。工番を選ぶと右に機械の一覧が出て、選んだ機械の欄だけを表示する
  const groups = noteGroups(data);
  const pages = [{ key: '__all', label: '全体', title: '全体の決定事項' },
    ...groups.map(g => ({ key: g.pn, label: g.pn, title: `${g.pn}　${g.customer}`, group: g }))];
  if (!pages.some(s => s.key === dockKey)) dockKey = '__all';
  const page = pages.find(s => s.key === dockKey);
  const slots = page.group ? page.group.slots : [];
  if (page.group && !slots.some(s => s.machine === dockMachine)) dockMachine = slots[0] ? slots[0].machine : null;

  const segButton = (label, title, active, onClick) => {
    const b = document.createElement('button');
    b.className = active ? 'active' : '';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const segLabel = text => {
    const l = document.createElement('span');
    l.className = 'dock-seg-label';
    l.textContent = text;
    return l;
  };
  tabs.innerHTML = '';
  pages.forEach((s, i) => {
    if (i === 1) tabs.appendChild(segLabel('工番')); // 「全体」と工番の間に見出し
    tabs.appendChild(segButton(s.label, s.title, s.key === dockKey, () => {
      dockKey = s.key; dockMachine = null;
      if (!dockOpen) setDockOpen(true); else renderDock();
    }));
  });
  mTabs.innerHTML = '';
  mTabs.hidden = !page.group;
  if (page.group) mTabs.appendChild(segLabel('機械'));
  slots.forEach(s => mTabs.appendChild(segButton(s.title, `${page.group.pn}　${s.title}`, s.machine === dockMachine, () => {
    dockMachine = s.machine;
    if (!dockOpen) setDockOpen(true); else renderDock();
  })));

  if (!dockOpen) return;
  const slot = page.group ? slots.find(s => s.machine === dockMachine) : null;
  const key = page.group ? (slot ? slot.key : null) : '__all';
  body.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'dock-slot-title';
  title.innerHTML = '<b></b><span></span>';
  title.querySelector('b').textContent = slot ? `${page.title}　${slot.title}` : page.title;
  title.querySelector('span').textContent = meeting.meeting_date === todayStr()
    ? `${fmtMeetingDate(meeting.meeting_date)}　前回の内容を引き継いでいます`
    : `${fmtMeetingDate(meeting.meeting_date)}（前回）${canEdit ? '　「会議を始める」で今日の議事録に引き継ぎます' : ''}`;
  if (canEdit && key) title.appendChild(createRichToolbar()); // 見出しと書式のボタンを1行にまとめる
  body.appendChild(title);
  if (!key) return;
  const ed = createEditor(meeting, key, getBody(data, key));
  ed.classList.add('dock-editor');
  body.appendChild(ed);
}

// ─── 会議の開始・終了 ─────────────────────────────────
function renderMeetingState() {
  const active = activeMeeting();
  document.getElementById('meeting-lamp').hidden = !active;
  document.getElementById('btn-meeting-start').hidden = !canEdit || !!active;
  document.getElementById('btn-meeting-end').hidden = !canEdit || !active;
  const latest = minutesList[0];
  document.getElementById('view-sub').textContent = active
    ? `電気工程会議 ${fmtMeetingDate(active.meeting_date)}`
    : latest ? `前回の会議 ${fmtMeetingDate(latest.meeting_date)}` : '';
}

async function startMeeting() {
  if (!canEdit) return;
  await flushEditors();
  const m = await createMinutes(todayStr(), { start: true });
  if (!m) return;
  renderMeetingState();
  setDockOpen(true);
  if (currentView === 'minutes') selectMinutes(todayStr());
}

async function endMeeting() {
  const m = activeMeeting();
  if (!m) return;
  await flushEditors();
  const { error } = await sb.from('denki_meetings')
    .update({ ended_at: new Date().toISOString(), updated_by: await currentEmail() }).eq('id', m.id);
  if (error) { minutesError(error); return; }
  await loadMinutesList();
  renderMeetingState();
  setDockOpen(false);
}

document.getElementById('btn-meeting-start').addEventListener('click', startMeeting);
document.getElementById('btn-meeting-end').addEventListener('click', endMeeting);

// ─── 保存 ───────────────────────────────────────────
// 議事録を作る。その日より前の一番新しい回の内容（決定事項と全部の欄）を引き継ぐ
async function createMinutes(dateStr, { start = false } = {}) {
  const existing = meetingByDate(dateStr);
  if (existing) {
    if (start) {
      const { error } = await sb.from('denki_meetings')
        .update({ started_at: new Date().toISOString(), ended_at: null, updated_by: await currentEmail() }).eq('id', existing.id);
      if (error) { minutesError(error); return null; }
      await loadMinutesList();
    }
    return meetingByDate(dateStr);
  }

  const prev = minutesList.find(m => m.meeting_date < dateStr);
  let prevData = null;
  if (prev) {
    try { prevData = await loadMeetingData(prev); }
    catch (e) { minutesError(e); return null; }
  }
  const email = await currentEmail();
  const row = { meeting_date: dateStr, decisions: prevData ? prevData.decisions : null, updated_by: email };
  if (start) row.started_at = new Date().toISOString();
  const { data, error } = await sb.from('denki_meetings').insert(row).select('id').single();
  if (error) { minutesError(error); return null; }

  if (prevData) {
    const rows = Object.entries(prevData.notes).filter(([, body]) => body).map(([k, body]) => {
      const [pn, machine] = splitKey(k);
      return { meeting_id: data.id, project_number: pn, machine, body, updated_by: email };
    });
    if (rows.length) {
      const r = await sb.from('denki_meeting_notes').insert(rows);
      if (r.error) minutesError(r.error);
    }
  }
  await loadMinutesList();
  return meetingByDate(dateStr);
}

async function saveBody(meetingId, key, body) {
  const ok = key === '__all' ? await saveDecisions(meetingId, body) : await saveNote(meetingId, ...splitKey(key), body);
  if (ok && minutesCache[meetingId]) {
    if (key === '__all') minutesCache[meetingId].decisions = body;
    else if (body) minutesCache[meetingId].notes[key] = body;
    else delete minutesCache[meetingId].notes[key];
  }
  return ok;
}

async function saveDecisions(meetingId, body) {
  const { data, error } = await sb.from('denki_meetings')
    .update({ decisions: body, updated_at: new Date().toISOString(), updated_by: await currentEmail() })
    .eq('id', meetingId).select('id');
  if (error || !data.length) { minutesError(error || new Error('権限がないか、ログインが切れています')); return false; }
  return true;
}

async function saveNote(meetingId, pn, machine, body) {
  let res;
  if (body) {
    res = await sb.from('denki_meeting_notes').upsert(
      { meeting_id: meetingId, project_number: pn, machine, body, updated_at: new Date().toISOString(), updated_by: await currentEmail() },
      { onConflict: 'meeting_id,project_number,machine' });
  } else {
    res = await sb.from('denki_meeting_notes').delete()
      .eq('meeting_id', meetingId).eq('project_number', pn).eq('machine', machine);
  }
  if (res.error) { minutesError(res.error); return false; }
  return true;
}

async function deleteMinutes(meeting) {
  if (!confirm(`${fmtMeetingDate(meeting.meeting_date)} の議事録を削除しますか？\n全体の決定事項と機械ごとの欄がすべて消えます。`)) return;
  const { data, error } = await sb.from('denki_meetings').delete().eq('id', meeting.id).select('id');
  if (error || !data.length) { minutesError(error || new Error('権限がないか、ログインが切れています')); return; }
  delete minutesCache[meeting.id];
  await loadMinutesList();
  renderMeetingState();
  renderDock();
  selectMinutes(minutesList[0]?.meeting_date || todayStr());
}

// ─── 印刷・PDF ─────────────────────────────────────
async function openPrint(meeting) {
  let data;
  try { data = await loadMeetingData(meeting); }
  catch (e) { alert('議事録を読み込めませんでした: ' + (e.message || e)); return; }
  const page = document.getElementById('pv-page');
  page.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'pv-title';
  head.innerHTML = '<b>電気工程会議 議事録</b><span></span>';
  head.querySelector('span').textContent = fmtMeetingDate(meeting.meeting_date);
  page.appendChild(head);

  const group = (pn, customer, slots) => {
    const g = document.createElement('div');
    g.className = 'pv-group';
    const h = document.createElement('div');
    h.className = 'pv-group-head';
    h.innerHTML = '<b></b><span></span>';
    h.querySelector('b').textContent = pn;
    h.querySelector('span').textContent = customer || '';
    g.appendChild(h);
    slots.forEach(s => {
      const row = document.createElement('div');
      row.className = 'pv-row';
      const t = document.createElement('div'); t.className = 'pv-row-title'; t.textContent = s.title;
      const b = document.createElement('div'); b.className = 'pv-row-body';
      b.innerHTML = richFromStored(getBody(data, s.key)) || '─';
      row.appendChild(t); row.appendChild(b);
      g.appendChild(row);
    });
    return g;
  };
  page.appendChild(group('全体', '', [{ key: '__all', title: '決定事項' }]));
  noteGroups(data).forEach(g => page.appendChild(group(g.pn, g.customer, g.slots)));
  document.getElementById('print-view').classList.add('open');
}
document.getElementById('pv-print').addEventListener('click', () => window.print());
document.getElementById('pv-close').addEventListener('click', () => document.getElementById('print-view').classList.remove('open'));

// ─── 操作 ───────────────────────────────────────────
document.getElementById('minutes-date').addEventListener('change', e => {
  if (e.target.value) selectMinutes(e.target.value);
});
document.getElementById('minutes-new').addEventListener('click', startMeeting);
// 保存されていない入力があるままページを閉じようとしたら確認する
window.addEventListener('beforeunload', e => {
  if (document.querySelector('.rt-editor.dirty')) { e.preventDefault(); e.returnValue = ''; }
});
