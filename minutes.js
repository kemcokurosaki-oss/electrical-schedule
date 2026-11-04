// ─── 議事録（電気工程会議） ─────────────────────────────
// 会議日ごとに「全体の決定事項」＋「工番の機械ごとの欄」（機械が合わない工程がある工番は「工番共通」の欄も）。
// 本文は書式付き（黒・赤・青・取り消し線）。開くと最新の議事録を表示し、書き込むと表示中の議事録に自動で保存する。
// 会議の分は「＋コピーして新規作成」で、表示中の内容を色や取り消し線ごと全部コピーした新しい日付の議事録を先に作ってから書く。
// 今日より前の議事録に書こうとしたら、直接直すか確認する。
// denki_meetings（会議日・決定事項）／denki_meeting_notes（工番＋機械ごとの欄。machine='' は工番共通）
let minutesList = [];          // [{ id, meeting_date }] 新しい順
let minutesSelectedDate = null;
let minutesLoaded = false;
let minutesPn = '__all';       // 議事録の画面で表示している工番（'__all' は全体）
const minutesCache = {};       // 会議 id → { decisions, notes: { '工番|機械': 本文 } }
let dockKey = '__all';         // 下の議事録欄で表示しているページ（'__all' か工番）
let dockMachine = null;        // 工番のページで表示している機械（'' は工番共通）
let dockOpen = false;
const pendingSaves = new Set(); // 保存中の処理
let saveState = null;          // 保存の状態の表示（'dirty' | 'saving' | 'saved' | 'error'）
let savedAt = null;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtMeetingDate(dateStr) {
  if (!dateStr) return '';
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
  const res = await sb.from('denki_meetings').select('id, meeting_date, updated_at').order('meeting_date', { ascending: false });
  if (res.error) { console.warn('議事録の一覧を読み込めませんでした', res.error); minutesList = []; return false; }
  minutesList = res.data;
  return true;
}

function meetingByDate(dateStr) {
  return minutesList.find(m => m.meeting_date === dateStr) || null;
}

let dockPinId = null;          // 「＋コピーして新規作成」で作った回の id（下の議事録欄はこの回を出す）
const pastEditOk = new Set();  // 過去の議事録を直接直すと確認済みの回の id

// 下の議事録欄に出す回: 新しく作った回 → 今日の議事録 → 一番新しい回 → （まだ1件も無ければ）空の議事録
function dockMeeting() {
  return (dockPinId && minutesList.find(m => m.id === dockPinId))
    || meetingByDate(todayStr()) || minutesList[0] || (canEdit ? { id: null, meeting_date: null } : null);
}

// いま表示している回（議事録の画面なら選んだ日、ガントの画面なら下の議事録欄）
function shownMeeting() {
  if (currentView === 'minutes') return meetingByDate(minutesSelectedDate);
  return dockMeeting();
}

// 見出しの横の注意書き: 今日より前の議事録を表示しているとき
function pastNoteText(meeting) {
  if (!canEdit || !meeting || !meeting.id || meeting.meeting_date >= todayStr()) return '';
  return `過去（${fmtMeetingDate(meeting.meeting_date)}）の議事録です。今日の会議の分は「＋コピーして新規作成」で作ってから書いてください`;
}

// 表示中の議事録の内容をコピーして、選んだ日付の議事録を作り、表示をその回に切り替える
async function copyMeetingTo(src, dateStr) {
  if (!dateStr) return null;
  await flushEditors();
  if (src && src.id && src.meeting_date === dateStr) { alert('表示中の議事録と同じ日付です。別の日付を選んでください。'); return null; }
  const ex = meetingByDate(dateStr);
  if (ex) {
    if (!confirm(`${fmtMeetingDate(dateStr)} の議事録はすでにあります。表示中の内容で上書きしますか？\n（${fmtMeetingDate(dateStr)} の今の内容は消えます）`)) return null;
    if (!(await deleteMeetingRow(ex))) return null;
  }
  const m = await createMinutes(dateStr, src && src.id ? src : null);
  if (!m) return null;
  dockPinId = m.id;
  minutesSelectedDate = dateStr;
  setSaveState('saved');
  renderDock();
  if (currentView === 'minutes') selectMinutes(dateStr);
  return m;
}

// 「＋コピーして新規作成」ボタン（押すと日付を選ぶ欄が出る。最初は今日）
// side=true は議事録の画面の左の欄に置く大きい形（「＋ 新しい議事録」）
let openNewForm = null; // 議事録の画面の「＋ 新しい議事録」の欄を開く（過去の議事録の案内から呼ぶ）
function createNewDateControls(side) {
  const wrap = document.createElement('span');
  wrap.className = 'new-date-controls' + (side ? ' side' : '');
  const closed = document.createElement('span');
  closed.className = 'new-date-closed';
  const open = document.createElement('button');
  open.className = side ? 'btn btn-dark new-open' : 'btn';
  open.textContent = side ? '＋ 新しい議事録' : '＋コピーして新規作成';
  open.title = '表示中の議事録の内容をコピーして、選んだ日付の新しい議事録を作ります';
  closed.appendChild(open);
  if (side) {
    const hint = document.createElement('span');
    hint.className = 'new-hint';
    hint.textContent = '表示中の内容（色・取り消し線も）を引き継いで作成します';
    closed.appendChild(hint);
  }
  const form = document.createElement('span');
  form.className = 'new-date-form';
  form.hidden = true;
  const di = document.createElement('input');
  di.type = 'date';
  di.className = 'save-date';
  const ok = document.createElement('button');
  ok.className = 'btn btn-dark btn-save';
  ok.textContent = '作成';
  const cancel = document.createElement('button');
  cancel.className = side ? 'btn btn-save' : 'link';
  cancel.textContent = 'やめる';
  const from = document.createElement('span');
  from.className = 'new-hint';
  const show = on => {
    closed.hidden = on; form.hidden = !on;
    if (on) {
      const src = shownMeeting();
      from.textContent = src && src.id ? `${fmtMeetingDate(src.meeting_date)} の内容を引き継ぎます` : '';
      di.value = todayStr(); di.focus();
    }
  };
  open.addEventListener('click', () => show(true));
  cancel.addEventListener('click', () => show(false));
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    const m = await copyMeetingTo(shownMeeting(), di.value);
    ok.disabled = false;
    if (m) show(false);
  });
  if (side) {
    const label = document.createElement('span');
    label.className = 'new-date-form-label';
    label.textContent = '会議の日付';
    const btns = document.createElement('span');
    btns.className = 'new-date-form-btns';
    btns.appendChild(ok); btns.appendChild(cancel);
    form.appendChild(label); form.appendChild(di); form.appendChild(from); form.appendChild(btns);
    openNewForm = () => show(true);
  } else {
    form.appendChild(di); form.appendChild(ok); form.appendChild(cancel);
  }
  wrap.appendChild(closed); wrap.appendChild(form);
  return wrap;
}

// ─── 保存の状態と保存ボタン ───────────────────────────
function setSaveState(state) {
  saveState = state;
  if (state === 'saved') savedAt = new Date();
  renderSaveState();
}
function renderSaveState() {
  const hm = savedAt ? `${savedAt.getHours()}:${String(savedAt.getMinutes()).padStart(2, '0')}` : '';
  const text = { dirty: '● 未保存の変更あり', saving: '… 保存中', saved: `✓ 保存しました ${hm}`, error: '× 保存できませんでした' }[saveState] || '';
  document.querySelectorAll('.save-status').forEach(el => { el.textContent = text; el.dataset.state = saveState || ''; });
  const note = pastNoteText(shownMeeting());
  document.querySelectorAll('.save-note').forEach(el => { el.textContent = note; el.hidden = !note; });
}
// withNew=false: 「＋コピーして新規作成」を付けない（議事録の画面では左の欄に置く）
function createSaveControls(withNew = true) {
  const wrap = document.createElement('span');
  wrap.className = 'save-controls';
  if (withNew) wrap.appendChild(createNewDateControls());
  const st = document.createElement('span');
  st.className = 'save-status';
  const b = document.createElement('button');
  b.className = 'btn btn-dark btn-save';
  b.textContent = '保存';
  b.title = '入力欄から離れたときにも自動で保存します';
  b.addEventListener('click', async () => {
    await flushEditors();
    if (!document.querySelector('.rt-editor.dirty') && saveState !== 'error') setSaveState('saved');
  });
  wrap.appendChild(st);
  wrap.appendChild(b);
  setTimeout(renderSaveState, 0);
  return wrap;
}

// まだ議事録が1件も無いときに書き込んだら、今日の議事録を作る（同時に何か所から呼ばれても1回だけ）
let creatingFirst = null;
async function ensureFirstMeeting() {
  const t = meetingByDate(todayStr());
  if (t) return t;
  if (!creatingFirst) creatingFirst = createMinutes(todayStr()).finally(() => { creatingFirst = null; });
  const m = await creatingFirst;
  if (m) setTimeout(() => { if (!document.activeElement?.classList.contains('rt-editor')) { renderDock(); if (currentView === 'minutes') selectMinutes(todayStr()); } }, 0);
  return m;
}

// 今日より前の議事録の入力欄を押したとき、直接直すか確認する（1つの回につき1回だけ）
async function confirmPastEdit(meeting, ed) {
  if (!meeting.id || meeting.meeting_date >= todayStr() || pastEditOk.has(meeting.id)) return;
  ed.blur();
  if (confirm(`${fmtMeetingDate(meeting.meeting_date)} の議事録を直接直しますか？\n\n［OK］このまま ${fmtMeetingDate(meeting.meeting_date)} の議事録を直す\n［キャンセル］今日の議事録を作って、そちらに書く`)) {
    pastEditOk.add(meeting.id);
    ed.focus();
    return;
  }
  const today = meetingByDate(todayStr());
  if (today) {
    alert(`今日（${fmtMeetingDate(todayStr())}）の議事録はすでにあるので、そちらを開きます。`);
    dockPinId = today.id;
    minutesSelectedDate = today.meeting_date;
    renderDock();
    if (currentView === 'minutes') selectMinutes(today.meeting_date);
    return;
  }
  await copyMeetingTo(meeting, todayStr());
}

async function loadMeetingData(meeting) {
  if (!meeting.id) return { decisions: null, notes: {} }; // まだ1件も無いときの空の議事録
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
  ed.addEventListener('input', () => {
    ed.classList.toggle('dirty', ed.innerHTML !== saved);
    if (ed.classList.contains('dirty')) setSaveState('dirty');
  });
  ed.addEventListener('focus', () => confirmPastEdit(meeting, ed));
  ed.addEventListener('blur', () => {
    if (ed.innerHTML === saved) return;
    const current = ed.innerHTML;
    const clean = sanitizeRich(current);
    setSaveState('saving');
    const p = (async () => {
      const target = meeting.id ? meeting : await ensureFirstMeeting(); // まだ1件も無ければ今日の議事録を作る
      if (!target) { setSaveState('error'); return; }
      const ok = await saveBody(target.id, key, isBlankRich(clean) ? null : clean);
      if (ok) { saved = current; ed.classList.toggle('dirty', ed.innerHTML !== saved); }
      setSaveState(!ok ? 'error' : document.querySelector('.rt-editor.dirty') ? 'dirty' : 'saved');
    })().finally(() => pendingSaves.delete(p));
    pendingSaves.add(p);
  });
  return ed;
}

// 書式のボタン（文字を選んでから押す）
// 文字の色は赤（訂正）と青（追記）だけ。黒に戻すときは「書式解除」
const RT_COLORS = [['赤＝訂正', '#c03030'], ['青＝追記', '#1f5fa8']];
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
  const hint = document.createElement('span');
  hint.className = 'rt-hint';
  hint.textContent = '文字を選んでから押す';
  bar.appendChild(hint);

  const colors = document.createElement('span');
  colors.className = 'rt-colors';
  RT_COLORS.forEach(([label, color]) => {
    const b = button('rt-color-btn', `文字の色：${label}`, () => run('foreColor', color));
    b.innerHTML = '<span class="rt-swatch"></span><span></span>';
    b.style.color = color;
    b.firstChild.style.background = color;
    b.lastChild.textContent = label;
    colors.appendChild(b);
  });
  bar.appendChild(colors);

  const strike = button('strike', '取り消し線（もう一度押すと解除）', () => run('strikeThrough'));
  strike.innerHTML = '<span class="rt-s">abc</span> 取り消し線';
  bar.appendChild(strike);
  const clear = button('clear', '色と取り消し線を外す（黒に戻す）', () => run('removeFormat'));
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
  if (!minutesLoaded) {
    minutesLoaded = true;
    selectMinutes(dockMeeting()?.meeting_date || todayStr());
  } else {
    selectMinutes(minutesSelectedDate);
  }
}

function renderMinutesList() {
  const nw = document.getElementById('minutes-new');
  if (canEdit && !nw.firstChild) nw.appendChild(createNewDateControls(true));
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
    b.innerHTML = '<span></span>';
    b.firstChild.textContent = fmtMeetingDate(m.meeting_date);
    if (m.meeting_date === todayStr()) {
      const t = document.createElement('span');
      t.className = 'minutes-today';
      t.textContent = '今日';
      b.appendChild(t);
    }
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
    renderMinutesMeta(null);
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
        if (await createMinutes(dateStr)) { selectMinutes(dateStr); renderDock(); }
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
  s.innerHTML = '<span class="red">赤＝訂正</span><span class="blue">青＝追記</span>';
  return s;
}

// 上のバーの「引き継ぎ元」「最終更新」（議事録の画面のときだけ表示）
function fmtStamp(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function renderMinutesMeta(meeting) {
  const el = document.getElementById('minutes-meta');
  el.innerHTML = '';
  if (!meeting || !meeting.id) return;
  const item = (label, value) => {
    const s = document.createElement('span');
    s.className = 'bar-meta-item';
    s.innerHTML = '<span></span><b></b>';
    s.firstChild.textContent = label;
    s.lastChild.textContent = value;
    el.appendChild(s);
  };
  const prev = minutesList.find(m => m.meeting_date < meeting.meeting_date); // 一覧は新しい順なので、最初に見つかった回が前回
  item('引き継ぎ元', prev ? `前回 ${fmtMeetingDate(prev.meeting_date)}` : 'なし（最初の議事録）');
  if (meeting.updated_at) item('最終更新', fmtStamp(meeting.updated_at));
}

// 「⋯」のメニュー（印刷・PDF と削除）
function createMoreMenu(items) {
  const wrap = document.createElement('span');
  wrap.className = 'more-menu';
  const btn = document.createElement('button');
  btn.className = 'btn btn-more';
  btn.textContent = '⋯';
  btn.title = 'その他の操作';
  const pop = document.createElement('div');
  pop.className = 'more-pop';
  pop.hidden = true;
  const close = e => { if (!wrap.contains(e.target)) { pop.hidden = true; document.removeEventListener('mousedown', close); } };
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) document.addEventListener('mousedown', close);
    else document.removeEventListener('mousedown', close);
  });
  items.forEach(it => {
    if (it.sep) { const d = document.createElement('div'); d.className = 'more-sep'; pop.appendChild(d); return; }
    const b = document.createElement('button');
    b.className = 'more-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    b.addEventListener('click', () => { pop.hidden = true; document.removeEventListener('mousedown', close); it.onClick(); });
    pop.appendChild(b);
  });
  wrap.appendChild(btn); wrap.appendChild(pop);
  return wrap;
}

function renderMinutesMain(meeting, data) {
  const main = document.getElementById('minutes-main');
  main.innerHTML = '';
  renderMinutesMeta(meeting);
  const isPast = meeting.meeting_date < todayStr();

  // 見出し: 左に日付、右に保存（よく使う）と「⋯」（印刷・PDF、削除）
  const head = document.createElement('div');
  head.className = 'minutes-head';
  const h2 = document.createElement('h2');
  h2.textContent = `${fmtMeetingDate(meeting.meeting_date)}　電気工程会議`;
  head.appendChild(h2);
  if (isPast) {
    const tag = document.createElement('span');
    tag.className = 'past-tag';
    tag.textContent = '過去の議事録';
    head.appendChild(tag);
  }
  const right = document.createElement('div');
  right.className = 'minutes-head-right';
  if (canEdit) right.appendChild(createSaveControls(false));
  const menu = [{ label: '印刷・PDF', onClick: async () => { await flushEditors(); openPrint(meeting); } }];
  if (canEdit) menu.push({ sep: true }, { label: 'この議事録を削除', danger: true, onClick: () => deleteMinutes(meeting) });
  right.appendChild(createMoreMenu(menu));
  head.appendChild(right);
  // 見出し・案内・タブ・書式のボタンは、スクロールしても上に残す
  const top = document.createElement('div');
  top.className = 'minutes-top';
  top.appendChild(head);
  main.appendChild(top);
  renderSaveState();

  // 過去の議事録を表示しているときの案内
  if (canEdit && isPast) {
    const banner = document.createElement('div');
    banner.className = 'carry-banner past-banner';
    const t = document.createElement('span');
    t.textContent = `${fmtMeetingDate(meeting.meeting_date)} の議事録を表示しています。今日の会議の分は、新しい議事録を作ってから書いてください。`;
    const b = document.createElement('button');
    b.className = 'btn btn-dark btn-save';
    b.textContent = '＋ 今日の議事録を作成';
    b.addEventListener('click', () => { if (openNewForm) openNewForm(); });
    banner.appendChild(t); banner.appendChild(b);
    top.appendChild(banner);
  }

  // 「全体」と工番のタブ（記入がある工番には青い点）
  const groups = noteGroups(data);
  if (minutesPn !== '__all' && !groups.some(g => g.pn === minutesPn)) minutesPn = '__all';
  const tabs = document.createElement('div');
  tabs.className = 'mn-tabs';
  const tab = (label, key, title, has) => {
    const b = document.createElement('button');
    b.className = 'mn-tab' + (key === minutesPn ? ' active' : '');
    b.textContent = label;
    b.title = title;
    if (has) { const d = document.createElement('span'); d.className = 'mn-tab-dot'; d.title = '記入あり'; b.appendChild(d); }
    b.addEventListener('click', async () => { await flushEditors(); minutesPn = key; renderMinutesMain(meeting, data); });
    tabs.appendChild(b);
  };
  tab('全体', '__all', '全体の決定事項', false);
  groups.forEach(g => tab(g.pn, g.pn, `${g.pn}　${g.customer}`, g.slots.some(s => data.notes[s.key])));
  top.appendChild(tabs);

  // 選んだタブの欄（見出しの行の右端に書式のボタン）
  const card = (pn, customer, slots) => {
    const c = document.createElement('div');
    c.className = 'mn-card';
    const h = document.createElement('div');
    h.className = 'mn-card-head';
    const ttl = document.createElement('div');
    ttl.className = 'mn-card-title';
    ttl.innerHTML = '<b></b><span></span>';
    ttl.querySelector('b').textContent = pn;
    ttl.querySelector('span').textContent = customer || '';
    h.appendChild(ttl);
    h.appendChild(canEdit ? createRichToolbar() : richLegend());
    c.appendChild(h);
    slots.forEach(s => {
      const row = document.createElement('div');
      row.className = 'mn-row';
      const t = document.createElement('div');
      t.className = 'mn-row-title';
      t.innerHTML = '<span></span>';
      t.firstChild.textContent = s.title;
      const hint = s.key === '__all' ? '会議全体で決まったこと' : s.machine === '' ? '機械が合わない工程' : '';
      if (hint) { const hs = document.createElement('span'); hs.className = 'mn-row-hint'; hs.textContent = hint; t.appendChild(hs); }
      const b = document.createElement('div');
      b.className = 'mn-row-body';
      const ed = createEditor(meeting, s.key, getBody(data, s.key));
      ed.classList.add(s.key === '__all' ? 'lg' : s.machine === '' ? 'sm' : 'md');
      b.appendChild(ed);
      row.appendChild(t); row.appendChild(b);
      c.appendChild(row);
    });
    return c;
  };
  const g = groups.find(x => x.pn === minutesPn);
  const c = g ? card(g.pn, g.customer, g.slots) : card('全体', '', [{ key: '__all', title: '決定事項' }]);
  top.appendChild(c.firstChild); // 工番の見出しの行（書式のボタン）も上に残す
  main.appendChild(c);
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
  const ds = document.getElementById('dock-save');
  if (canEdit && !ds.firstChild) ds.appendChild(createSaveControls());
  const tabs = document.getElementById('dock-tabs');
  const mTabs = document.getElementById('dock-machines');
  const body = document.getElementById('dock-body');
  const meeting = dockMeeting();
  if (!meeting) {
    tabs.innerHTML = '';
    document.getElementById('dock-all').innerHTML = '';
    mTabs.innerHTML = '';
    mTabs.hidden = true;
    body.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'dock-empty';
    p.textContent = '議事録はまだありません。';
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
  // 「全体」と工番は別の枠に分ける
  const allTab = document.getElementById('dock-all');
  allTab.innerHTML = '';
  tabs.hidden = pages.length < 2;
  pages.forEach((s, i) => {
    if (i === 1) tabs.appendChild(segLabel('工番'));
    (i === 0 ? allTab : tabs).appendChild(segButton(s.label, s.title, s.key === dockKey, () => {
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
  title.querySelector('span').textContent = meeting.id ? `${fmtMeetingDate(meeting.meeting_date)}の議事録` : '';
  const note = document.createElement('span');
  note.className = 'save-note';
  title.appendChild(note);
  if (canEdit && key) title.appendChild(createRichToolbar()); // 見出しと書式のボタンを1行にまとめる
  body.appendChild(title);
  renderSaveState();
  if (!key) return;
  const ed = createEditor(meeting, key, getBody(data, key));
  ed.classList.add('dock-editor');
  body.appendChild(ed);
}

// ─── 保存 ───────────────────────────────────────────
// 議事録を作る。source の回（省略時はその日より前の一番新しい回）の内容（決定事項と全部の欄）を引き継ぐ
async function createMinutes(dateStr, source) {
  const existing = meetingByDate(dateStr);
  if (existing) return existing;

  const prev = source || minutesList.find(m => m.meeting_date < dateStr);
  let prevData = null;
  if (prev) {
    try { prevData = await loadMeetingData(prev); }
    catch (e) { minutesError(e); return null; }
  }
  const email = await currentEmail();
  const row = { meeting_date: dateStr, decisions: prevData ? prevData.decisions : null, updated_at: new Date().toISOString(), updated_by: email };
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
  if (ok) { // 上のバーの「最終更新」を新しくする
    const m = minutesList.find(x => x.id === meetingId);
    if (m) m.updated_at = new Date().toISOString();
    if (currentView === 'minutes' && m && m.meeting_date === minutesSelectedDate) renderMinutesMeta(m);
  }
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
  // 工番の欄を直したときも、議事録の回の「最終更新」を新しくする
  const t = await sb.from('denki_meetings').update({ updated_at: new Date().toISOString(), updated_by: await currentEmail() }).eq('id', meetingId);
  if (t.error) console.warn('最終更新の時刻を記録できませんでした', t.error);
  return true;
}

// 議事録を1回分消す（欄は DB 側で一緒に消える）
async function deleteMeetingRow(meeting) {
  const { data, error } = await sb.from('denki_meetings').delete().eq('id', meeting.id).select('id');
  if (error || !data.length) { minutesError(error || new Error('権限がないか、ログインが切れています')); return false; }
  delete minutesCache[meeting.id];
  await loadMinutesList();
  return true;
}

async function deleteMinutes(meeting) {
  if (!confirm(`${fmtMeetingDate(meeting.meeting_date)} の議事録を削除しますか？\n全体の決定事項と機械ごとの欄がすべて消えます。`)) return;
  if (!(await deleteMeetingRow(meeting))) return;
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
// 保存されていない入力があるままページを閉じようとしたら確認する
window.addEventListener('beforeunload', e => {
  if (document.querySelector('.rt-editor.dirty')) { e.preventDefault(); e.returnValue = ''; }
});
