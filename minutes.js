// ─── 議事録（電気工程会議） ─────────────────────────────
// 会議日ごとに「全体の決定事項」＋「工番ごとの欄」。日付で検索して見返せる
// denki_meetings（会議日・決定事項）／denki_meeting_notes（工番ごとの欄）
let minutesList = [];          // [{ id, meeting_date }] 新しい順
let minutesSelectedDate = null;
let minutesLoaded = false;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtMeetingDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

async function currentEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || null;
}

function minutesError(e) {
  console.warn('議事録の保存エラー:', e);
  alert(`保存できませんでした。入力した内容は画面に残っています。\n${e.message || e}\n\nログインが切れている場合は、入力内容を控えてからページを再読み込みしてください。`);
}

// ─── 一覧 ───────────────────────────────────────────
async function showMinutes() {
  if (!minutesLoaded) {
    document.getElementById('minutes-new').style.display = canEdit ? '' : 'none';
    await loadMinutesList();
    minutesLoaded = true;
    selectMinutes(minutesList[0]?.meeting_date || todayStr());
  }
}

function todayStr() {
  return toDBDate(new Date());
}

async function loadMinutesList() {
  const { data, error } = await sb.from('denki_meetings').select('id, meeting_date').order('meeting_date', { ascending: false });
  if (error) { alert('議事録の一覧を読み込めませんでした。\n' + error.message); return; }
  minutesList = data;
  renderMinutesList();
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

// ─── 1回分の表示 ─────────────────────────────────────
async function selectMinutes(dateStr) {
  minutesSelectedDate = dateStr;
  document.getElementById('minutes-date').value = dateStr;
  renderMinutesList();

  const main = document.getElementById('minutes-main');
  const meeting = minutesList.find(m => m.meeting_date === dateStr);
  if (!meeting) {
    main.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'minutes-empty';
    p.textContent = `${fmtMeetingDate(dateStr)} の議事録はありません`;
    main.appendChild(p);
    if (canEdit) {
      const b = document.createElement('button');
      b.className = 'minutes-create-btn';
      b.textContent = 'この日の議事録を作成';
      b.addEventListener('click', () => createMinutes(dateStr));
      main.appendChild(b);
    }
    return;
  }

  main.textContent = '読み込み中...';
  // 前回の内容を出すため、この会議より前の数回分の工番欄も読む
  const earlier = minutesList.filter(m => m.meeting_date < dateStr).slice(0, 8);
  const [mRes, nRes, pRes] = await Promise.all([
    sb.from('denki_meetings').select('id, meeting_date, decisions').eq('id', meeting.id).single(),
    sb.from('denki_meeting_notes').select('project_number, body').eq('meeting_id', meeting.id),
    earlier.length
      ? sb.from('denki_meeting_notes').select('meeting_id, project_number, body').in('meeting_id', earlier.map(m => m.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const err = mRes.error || nRes.error || pRes.error;
  if (err) { main.textContent = '議事録を読み込めませんでした: ' + err.message; return; }
  if (minutesSelectedDate !== dateStr) return; // 読み込み中に別の日を選んだ

  const notes = {};
  nRes.data.forEach(n => { notes[n.project_number] = n.body; });
  const dateOf = Object.fromEntries(earlier.map(m => [m.id, m.meeting_date]));
  const prev = {}; // 工番 → 一番新しい前回の欄
  pRes.data.forEach(n => {
    const d = dateOf[n.meeting_id];
    if (!prev[n.project_number] || prev[n.project_number].date < d) prev[n.project_number] = { date: d, body: n.body };
  });
  renderMinutesMain(mRes.data, notes, prev);
}

function renderMinutesMain(meeting, notes, prev) {
  const main = document.getElementById('minutes-main');
  main.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'minutes-head';
  const h2 = document.createElement('h2');
  h2.textContent = `${fmtMeetingDate(meeting.meeting_date)}　電気工程会議`;
  head.appendChild(h2);
  if (canEdit) {
    const del = document.createElement('button');
    del.className = 'minutes-delete-btn';
    del.textContent = 'この議事録を削除';
    del.addEventListener('click', () => deleteMinutes(meeting));
    head.appendChild(del);
  }
  main.appendChild(head);

  // 全体の決定事項
  main.appendChild(minutesSection('全体の決定事項', '', meeting.decisions, null,
    body => saveDecisions(meeting.id, body)));

  // 工番ごとの欄: 表示中の工番＋この回に記入がある工番
  const customers = {};
  const machines = {};
  currentProjects.forEach(p => {
    customers[p.project_number] = p.customer_name;
    (machines[p.project_number] = machines[p.project_number] || []).push(p.machine || '(機種なし)');
  });
  const pns = [...new Set([...Object.keys(machines), ...Object.keys(notes)])].sort();
  pns.forEach(pn => {
    const sub = [customers[pn], (machines[pn] || []).join(' / ')].filter(Boolean).join('　');
    main.appendChild(minutesSection(pn, sub, notes[pn], prev[pn],
      body => saveNote(meeting.id, pn, body)));
  });
}

// 見出し＋前回の内容＋入力欄（閲覧のみの人は本文だけ）
function minutesSection(title, sub, body, prevNote, save) {
  const sec = document.createElement('div');
  sec.className = 'minutes-section';

  const h = document.createElement('div');
  h.className = 'minutes-section-title';
  const t = document.createElement('span'); t.textContent = title; h.appendChild(t);
  if (sub) { const s = document.createElement('span'); s.className = 'minutes-section-sub'; s.textContent = sub; h.appendChild(s); }
  sec.appendChild(h);

  if (prevNote) {
    const p = document.createElement('div');
    p.className = 'minutes-prev';
    p.textContent = `前回（${fmtMeetingDate(prevNote.date)}）: ${prevNote.body}`;
    sec.appendChild(p);
  }

  if (!canEdit) {
    const v = document.createElement('div');
    v.className = 'minutes-body';
    v.textContent = body || '─';
    sec.appendChild(v);
    return sec;
  }

  const ta = document.createElement('textarea');
  ta.className = 'minutes-text';
  ta.value = body || '';
  let saved = ta.value;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', () => { grow(); ta.classList.toggle('dirty', ta.value !== saved); });
  ta.addEventListener('blur', async () => {
    if (ta.value === saved) return;
    const value = ta.value;
    if (await save(value.trim() || null)) {
      saved = value;
      ta.classList.toggle('dirty', ta.value !== saved);
    }
  });
  sec.appendChild(ta);
  requestAnimationFrame(grow);
  return sec;
}

// ─── 保存 ───────────────────────────────────────────
async function createMinutes(dateStr) {
  const { error } = await sb.from('denki_meetings').insert({ meeting_date: dateStr, updated_by: await currentEmail() });
  if (error) { minutesError(error); return; }
  await loadMinutesList();
  selectMinutes(dateStr);
}

async function saveDecisions(meetingId, body) {
  const { data, error } = await sb.from('denki_meetings')
    .update({ decisions: body, updated_at: new Date().toISOString(), updated_by: await currentEmail() })
    .eq('id', meetingId).select('id');
  if (error || !data.length) { minutesError(error || new Error('権限がないか、ログインが切れています')); return false; }
  return true;
}

async function saveNote(meetingId, pn, body) {
  let res;
  if (body) {
    res = await sb.from('denki_meeting_notes').upsert(
      { meeting_id: meetingId, project_number: pn, body, updated_at: new Date().toISOString(), updated_by: await currentEmail() },
      { onConflict: 'meeting_id,project_number' });
  } else {
    res = await sb.from('denki_meeting_notes').delete().eq('meeting_id', meetingId).eq('project_number', pn);
  }
  if (res.error) { minutesError(res.error); return false; }
  return true;
}

async function deleteMinutes(meeting) {
  if (!confirm(`${fmtMeetingDate(meeting.meeting_date)} の議事録を削除しますか？\n全体の決定事項と工番ごとの欄がすべて消えます。`)) return;
  const { data, error } = await sb.from('denki_meetings').delete().eq('id', meeting.id).select('id');
  if (error || !data.length) { minutesError(error || new Error('権限がないか、ログインが切れています')); return; }
  await loadMinutesList();
  selectMinutes(minutesList[0]?.meeting_date || todayStr());
}

// ─── 操作 ───────────────────────────────────────────
document.getElementById('minutes-date').addEventListener('change', e => {
  if (e.target.value) selectMinutes(e.target.value);
});
document.getElementById('minutes-new').addEventListener('click', () => selectMinutes(todayStr()));
// 保存されていない入力があるままページを閉じようとしたら確認する
window.addEventListener('beforeunload', e => {
  if (document.querySelector('.minutes-text.dirty')) { e.preventDefault(); e.returnValue = ''; }
});
