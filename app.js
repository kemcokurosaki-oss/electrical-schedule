// ─── 画面切替（左メニュー） ──────────────────────────────
// v2: 進捗確認表と議事録の2画面。ガントチャートは読み込まない（ファイルは残している）
let currentView = 'sheet';
const VIEW_TITLES = { sheet: '進捗確認表', minutes: '議事録' };

// v2 で追加した状態
let allColumns = [];          // 完了工番も含めた全部の列（完了工番の画面・議事録の並び順に使う）
let customerOf = {};          // 工番 → 客先名
let denkiCompleted = new Set(); // 電気工程表で完了にした工番
let meetingToday = null;      // 今日の会議（denki_meetings の行）
let todayHistory = {};        // 今日の会議の記録（noteKey → 行）

function showView(name) {
  if (!VIEW_TITLES[name]) name = 'sheet';
  currentView = name;
  document.body.dataset.view = name;
  Object.keys(VIEW_TITLES).forEach(v => {
    document.getElementById('tab-' + v).classList.toggle('active', v === name);
    document.getElementById('view-' + v).classList.toggle('active', v === name);
  });
  document.getElementById('view-title').textContent = VIEW_TITLES[name];
  if (name === 'sheet') renderSheet();
  if (name === 'minutes') showMinutes();
  renderNavProjects();
}

document.getElementById('tab-sheet').addEventListener('click', () => showView('sheet'));
document.getElementById('tab-minutes').addEventListener('click', () => showView('minutes'));
// アプリのアイコンはページを開き直す
document.getElementById('nav-logo').addEventListener('click', () => location.reload());

// ─── 左メニューの工事番号 ─────────────────────────────
// 押すとその工番だけを表示。もう一度押すと全部に戻る
function renderNavProjects() {
  const box = document.getElementById('nav-projects');
  box.innerHTML = '';
  const seen = new Set();
  currentProjects.forEach(p => {
    const pn = p.project_number;
    if (seen.has(pn)) return;
    seen.add(pn);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'v2-np' + (pn === sheetPn && currentView === 'sheet' ? ' active' : '');
    b.title = `${pn} ${p.customer_name || ''}`;
    b.textContent = pn;
    b.addEventListener('click', () => {
      setSheetPn(sheetPn === pn ? null : pn);
      if (currentView !== 'sheet') showView('sheet'); else { renderSheet(); renderNavProjects(); }
    });
    box.appendChild(b);
  });
}

// ─── データ読み込み ───────────────────────────────────
const TASK_COLUMNS = 'id, project_number, machine, unit, parent, text, major_item, start_date, end_date, is_completed, is_archived, sort_order, customer_name';

async function fetchTasks(projectNumbers) {
  return fetchAll(() => sb.from('tasks').select(TASK_COLUMNS).in('project_number', projectNumbers).order('id'));
}

async function fetchColumns() {
  // 標準日程（schedule.js）用の sched_* の列は、SQL を実行するまで無いので、読めなければ無しで読む
  const withSched = await sb.from('denki_columns').select('project_number, machine, link_machine, unit, sort_order, sched_filled_at, sched_bankumi, sched_test');
  schedColsReady = !withSched.error;
  if (!withSched.error) return withSched;
  console.warn('denki_columns の sched_* を読めないため、標準日程の自動入力・連動を止めます', withSched.error);
  const res = await sb.from('denki_columns').select('project_number, machine, link_machine, unit, sort_order');
  if (!res.error) return res;
  console.warn('denki_columns の unit を読めないため、ユニットなしで表示します', res.error);
  return sb.from('denki_columns').select('project_number, machine, link_machine, sort_order');
}

async function loadData() {
  const today = todayStr();
  const [completedRes, denkiDoneRes, colRes, stepRes, meetRes, histRes, ruleRes] = await Promise.all([
    sb.from('completed_projects').select('project_number'),
    sb.from('denki_completed_projects').select('project_number'),
    fetchColumns(),
    sb.from('denki_steps').select('process_no, steps'),
    sb.from('denki_meetings').select('*').eq('meeting_date', today).maybeSingle(),
    sb.from('denki_history').select('*').eq('meeting_date', today),
    sb.from('denki_schedule_rules').select('rule_key, weeks'),
  ]);
  // 標準日程の決まりは SQL を実行するまで無いので、読めなければ最初の決まりを使う
  schedRulesReady = !ruleRes.error;
  applyScheduleRules(ruleRes.error ? [] : ruleRes.data);
  [completedRes, denkiDoneRes, colRes, stepRes, meetRes, histRes].forEach(r => { if (r.error) throw r.error; });

  const completedNums = new Set((completedRes.data || []).map(c => String(c.project_number)));
  denkiCompleted = new Set((denkiDoneRes.data || []).map(c => String(c.project_number)));
  stepDefs = {};
  (stepRes.data || []).forEach(r => { if (r.steps && r.steps.length) stepDefs[r.process_no] = r.steps; });
  meetingToday = meetRes.data || null;
  todayHistory = {};
  (histRes.data || []).forEach(r => { todayHistory[noteKey(r.project_number, r.machine, r.process_no)] = r; });

  allColumns = colRes.data
    .filter(c => !completedNums.has(String(c.project_number)))
    .map(c => ({ project_number: String(c.project_number), machine: c.machine,
                 link_machine: c.link_machine || c.machine, unit: String(c.unit || '').trim(), sort_order: c.sort_order,
                 sched_filled_at: c.sched_filled_at || null, sched_bankumi: c.sched_bankumi || null, sched_test: c.sched_test || null }))
    .sort((a, b) => a.project_number.localeCompare(b.project_number) || a.sort_order - b.sort_order);
  currentProjects = allColumns.filter(c => !denkiCompleted.has(c.project_number));

  ganttTasks = {}; colTasks = {}; ganttOther = {}; statusMap = {}; itemMemos = {}; itemInfo = {};
  if (currentProjects.length === 0) return;

  const projectNumbers = [...new Set(currentProjects.map(p => p.project_number))];
  const [tasks, statusRows, memoRows, infoRows] = await Promise.all([
    fetchTasks(projectNumbers),
    fetchAll(() => sb.from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, updated_at')
      .in('project_number', projectNumbers).order('project_number').order('machine').order('process_no')),
    fetchAll(() => sb.from('denki_item_memos').select('project_number, machine, process_no, body, updated_at')
      .in('project_number', [...projectNumbers, GLOBAL_PN]).order('project_number')),
    fetchAll(() => sb.from('denki_item_info').select('project_number, machine, process_no, ball, due_date, steps, updated_at')
      .in('project_number', projectNumbers).order('project_number')),
  ]);
  memoRows.forEach(r => { itemMemos[noteKey(r.project_number, r.machine, r.process_no)] = { body: r.body, updated_at: r.updated_at }; });
  infoRows.forEach(r => { itemInfo[noteKey(r.project_number, r.machine, r.process_no)] = r; });

  tasks.forEach(t => {
    if (t.customer_name && !customerOf[t.project_number]) customerOf[t.project_number] = t.customer_name;
  });
  currentProjects.forEach(p => { p.customer_name = customerOf[p.project_number] || ''; });

  // 工場出荷の日付を拾うため、電気関係のタスクを列へ振り分ける（今までと同じ）
  currentProjects.forEach(proj => { ganttTasks[`${proj.project_number}__${proj.machine}`] = []; colTasks[`${proj.project_number}__${proj.machine}`] = []; });
  // 標準日程（schedule.js）用に、電気関係に限らず列ごとのタスクを持っておく
  tasks.filter(t => !t.is_archived).forEach(t => {
    const pn = String(t.project_number);
    currentProjects.filter(p => p.project_number === pn && machineMatches(p.link_machine, t.machine) && unitMatches(p.unit, t.unit))
      .forEach(p => colTasks[`${pn}__${p.machine}`].push(t));
  });
  tasks
    .filter(t => !t.is_archived && isElectricalTask(t))
    .forEach(t => {
      const pn = String(t.project_number);
      const cols = currentProjects.filter(p => p.project_number === pn && machineMatches(p.link_machine, t.machine) && unitMatches(p.unit, t.unit));
      if (cols.length) cols.forEach(p => ganttTasks[`${pn}__${p.machine}`].push(t));
      else (ganttOther[pn] = ganttOther[pn] || []).push(t);
    });

  statusRows.forEach(s => {
    statusMap[`${s.project_number}__${s.machine}__${s.process_no}`] = {
      status: s.status, start_date: s.start_date, end_date: s.end_date, updated_at: s.updated_at,
    };
  });
}

function unitMatches(columnUnit, taskUnit) {
  if (!columnUnit) return true;
  const u = String(taskUnit || '').trim();
  return u === columnUnit || u === '' || u.toUpperCase() === 'ALL';
}

function renderAll() {
  renderNavProjects();
  renderMeetingBar();
  if (currentView === 'sheet') renderSheet();
  if (currentView === 'minutes') showMinutes(minutesDate);
}

// DB から読み直して全画面を描き直す
async function refreshDisplay() {
  showLoading();
  try {
    await loadData();
    await syncSchedules();
  } catch (e) {
    console.error(e);
    alert('データを読み込めませんでした。ページを再読み込みしてください。\n' + (e.message || e));
  }
  renderAll();
  hideLoading();
}

// ほかの人の変更を取り込むため、1分ごとに読み直す（入力中・保存中・画面を開いていないときはしない）
setInterval(async () => {
  if (document.hidden || isSaving()) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (!document.getElementById('admin-modal').hidden) return;
  try { await loadData(); renderAll(); if (await syncSchedules()) renderAll(); } catch (e) { console.warn('自動の読み直しに失敗', e); }
}, 60000);

// ─── 会議 ───────────────────────────────────────────
function meetingActive() {
  return !!meetingToday && !meetingToday.ended_at && meetingToday.meeting_date === todayStr();
}

function renderMeetingBar() {
  const box = document.getElementById('meeting-box');
  box.innerHTML = '';
  document.body.classList.toggle('in-meeting', meetingActive());
  if (meetingActive()) {
    const tag = document.createElement('span');
    tag.className = 'v2-meet-tag';
    tag.textContent = `会議中 ${fmtMD(meetingToday.meeting_date)}　変更は議事録に自動で記録されます`;
    box.appendChild(tag);
  }
  if (!canEdit) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'v2-meet-btn' + (meetingActive() ? ' end' : '');
  b.textContent = meetingActive() ? '会議を終える' : '会議を始める';
  b.title = meetingActive() ? '会議を終えて、今日の議事録を表示します' : '今日の会議を始めます。これ以降の変更が今日の議事録に入ります';
  b.addEventListener('click', () => meetingActive() ? endMeeting() : startMeeting());
  box.appendChild(b);
}

async function startMeeting() {
  const d = todayStr();
  const res = await sb.from('denki_meetings').upsert(
    { meeting_date: d, started_at: new Date().toISOString(), started_by: await currentEmail(), ended_at: null },
    { onConflict: 'meeting_date' }).select().single();
  if (res.error) { alert('会議を始められませんでした。\n' + res.error.message); return; }
  meetingToday = res.data;
  const h = await sb.from('denki_history').select('*').eq('meeting_date', d);
  todayHistory = {};
  (h.data || []).forEach(r => { todayHistory[noteKey(r.project_number, r.machine, r.process_no)] = r; });
  renderAll();
}

async function endMeeting() {
  await flushDetailMemo();
  const res = await sb.from('denki_meetings').update({ ended_at: new Date().toISOString() })
    .eq('meeting_date', meetingToday.meeting_date).select().single();
  if (res.error) { alert('会議を終えられませんでした。\n' + res.error.message); return; }
  meetingToday = res.data;
  renderMeetingBar();
  minutesDate = meetingToday.meeting_date;
  showView('minutes');
}

// ─── 権限 ───────────────────────────────────────────
// 編集できない人は、管理者メニュー・会議のボタンを出さず、詳細表示は見るだけ
async function setupEditPermission() {
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  canEdit = EDITORS.includes(String(user?.email || '').toLowerCase());
  document.getElementById('nav-admin').hidden = !canEdit;
  document.body.classList.toggle('read-only', !canEdit);
}

async function init() {
  await setupEditPermission();
  await refreshDisplay();
}

init();
