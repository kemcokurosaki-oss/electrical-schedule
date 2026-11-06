// ─── 画面切替（左メニュー） ──────────────────────────────
let currentView = 'sheet';
const VIEW_TITLES = { sheet: '工程確認表', gantt: 'ガントチャート', minutes: '議事録' };

function showView(name) {
  currentView = name;
  document.body.dataset.view = name;
  ['sheet', 'gantt', 'minutes'].forEach(v => {
    document.getElementById('tab-' + v).classList.toggle('active', v === name);
    document.getElementById('view-' + v).classList.toggle('active', v === name);
  });
  document.getElementById('view-title').textContent = VIEW_TITLES[name];
  if (name === 'gantt') setTimeout(() => showGantt(), 50);
  if (name === 'sheet') renderSheet(); // 議事録の画面で作った・直した内容と保存先の日付を表のメモにも反映
  if (name === 'minutes') showMinutes();
  renderNavProjects();
}

document.getElementById('tab-sheet').addEventListener('click',    () => showView('sheet'));
document.getElementById('tab-gantt').addEventListener('click',    () => showView('gantt'));
document.getElementById('tab-minutes').addEventListener('click',  () => showView('minutes'));

// ─── 左メニューの工事番号 ─────────────────────────────
// 押すと工程確認表（それ以外の画面ではガント）のその工番まで移動する。遅れがあれば赤い点、注意だけなら黄色の点
function renderNavProjects() {
  const box = document.getElementById('nav-projects');
  box.innerHTML = '';
  const seen = new Set();
  currentProjects.forEach(p => {
    const pn = p.project_number;
    if (seen.has(pn)) return;
    seen.add(pn);
    const b = document.createElement('button');
    b.className = 'np-item' + (pn === selectedPn && currentView !== 'minutes' ? ' active' : '');
    b.title = `${pn} ${p.customer_name || ''}`;
    const dot = taskStats.latePns.has(pn) ? 'late' : taskStats.soonPns.has(pn) ? 'soon' : '';
    b.innerHTML = `<span class="np-pn">${escapeHtml(pn)}${dot ? `<span class="np-dot ${dot}"></span>` : ''}</span>`
      + `<span class="np-customer">${escapeHtml(p.customer_name || '')}</span>`;
    b.addEventListener('click', () => {
      selectedPn = pn;
      if (currentView === 'sheet') scrollSheetToProject(pn);
      else {
        if (currentView !== 'gantt') showView('gantt');
        setTimeout(() => scrollGanttToProject(pn), 120);
      }
      renderNavProjects();
    });
    box.appendChild(b);
  });
}

// ─── 遅れ・注意の件数（上部バーのランプ） ──────────────
function computeStats() {
  taskStats = { late: 0, soon: 0, latePns: new Set(), soonPns: new Set() };
  const seen = new Set();
  const add = (pn, t) => {
    const k = `${pn}__${t.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    const s = taskState(t);
    if (s === 'late') { taskStats.late++; taskStats.latePns.add(pn); }
    if (s === 'soon') { taskStats.soon++; taskStats.soonPns.add(pn); }
  };
  Object.entries(ganttTasks).forEach(([key, list]) => { const pn = key.split('__')[0]; list.forEach(t => add(pn, t)); });
  Object.entries(ganttOther).forEach(([pn, list]) => list.forEach(t => add(pn, t)));
}

function renderLamps() {
  document.getElementById('late-count').textContent = taskStats.late;
  document.getElementById('soon-count').textContent = taskStats.soon;
  document.getElementById('late-lamp').classList.toggle('on', ganttFilters.late);
  document.getElementById('soon-lamp').classList.toggle('on', ganttFilters.soon);
  document.getElementById('soon-lamp').title = `終了日まで ${WARN_DAYS}日以内で未完了の工程だけを表示`;
}

function toggleLampFilter(key) {
  ganttFilters[key] = !ganttFilters[key];
  renderLamps();
  if (currentView !== 'gantt') showView('gantt');
  else applyGanttFilters();
}
document.getElementById('late-lamp').addEventListener('click', () => toggleLampFilter('late'));
document.getElementById('soon-lamp').addEventListener('click', () => toggleLampFilter('soon'));

// ─── 左メニューの幅 ───────────────────────────────────
// 画面幅が 1400px 未満なら細い表示。手動で切り替えたらその設定を覚える
function applyNavCompact() {
  const saved = localStorage.getItem('denki_nav_compact');
  const compact = saved === null ? window.innerWidth < 1400 : saved === '1';
  document.body.classList.toggle('nav-compact', compact);
  document.getElementById('nav-logo').title = compact ? 'メニューを広げる' : '';
}
// 広い表示: 「電気工程表」の右のボタンで縮める。細い表示: アプリのアイコンを押すと広げる
function setNavCompact(compact) {
  localStorage.setItem('denki_nav_compact', compact ? '1' : '0');
  applyNavCompact();
  setTimeout(resizeGantt, 0);
}
document.getElementById('nav-collapse').addEventListener('click', () => setNavCompact(true));
document.getElementById('nav-logo').addEventListener('click', () => {
  if (document.body.classList.contains('nav-compact')) setNavCompact(false);
});
window.addEventListener('resize', applyNavCompact);

// ─── データ読み込み ───────────────────────────────────
const TASK_COLUMNS = 'id, project_number, machine, unit, parent, text, major_item, start_date, end_date, is_completed, is_archived, sort_order, customer_name';

// 担当者（owner）も読む。列が読めないときは担当者なしで表示する
async function fetchTasks(projectNumbers) {
  const q = cols => fetchAll(() => sb.from('tasks').select(cols).in('project_number', projectNumbers).order('id'));
  try {
    return await q(TASK_COLUMNS + ', owner');
  } catch (e) {
    console.warn('担当者（owner）を読めないため、担当者なしで表示します', e);
    return q(TASK_COLUMNS);
  }
}

// 列の一覧。unit の列がまだ DB に無いときは、ユニットなしで読む
async function fetchColumns() {
  const res = await sb.from('denki_columns').select('project_number, machine, link_machine, unit, sort_order');
  if (!res.error) return res;
  console.warn('denki_columns の unit を読めないため、ユニットなしで表示します', res.error);
  return sb.from('denki_columns').select('project_number, machine, link_machine, sort_order');
}

async function loadData() {
  const [completedRes, colRes] = await Promise.all([
    sb.from('completed_projects').select('project_number'),
    fetchColumns(),
  ]);
  if (completedRes.error) throw completedRes.error;
  if (colRes.error) throw colRes.error;
  const completedNums = new Set((completedRes.data || []).map(c => String(c.project_number)));

  currentProjects = colRes.data
    .filter(c => !completedNums.has(String(c.project_number)))
    .map(c => ({ project_number: String(c.project_number), machine: c.machine,
                 link_machine: c.link_machine || c.machine, unit: String(c.unit || '').trim(), sort_order: c.sort_order }))
    .sort((a, b) => a.project_number.localeCompare(b.project_number) || a.sort_order - b.sort_order);

  ganttTasks = {}; ganttOther = {}; statusMap = {};
  if (currentProjects.length === 0) return;

  const projectNumbers = [...new Set(currentProjects.map(p => p.project_number))];

  // 電気関係かどうかは大項目・見出し・タスク名で判断するので、工番のタスクは全部読んでから選ぶ
  const [tasks, statusRows] = await Promise.all([
    fetchTasks(projectNumbers),
    fetchAll(() => sb.from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, tantousha, memo')
      .in('project_number', projectNumbers).order('project_number').order('machine').order('process_no')),
  ]);

  const custMap = {};
  tasks.forEach(t => {
    if (t.customer_name && !custMap[t.project_number]) custMap[t.project_number] = t.customer_name;
  });
  currentProjects.forEach(p => { p.customer_name = custMap[p.project_number] || ''; });

  // 電気関係のタスクを、機種名が合う列へ振り分ける（開始日の早い順。工場出荷は最後）。
  // どの列にも合わないもの（機種が空欄など）は、工番ごとの「工番共通・その他」に入れて取りこぼさない
  currentProjects.forEach(proj => { ganttTasks[`${proj.project_number}__${proj.machine}`] = []; });
  tasks
    .filter(t => !t.is_archived && isElectricalTask(t))
    .sort((a, b) => (a.text === '工場出荷') - (b.text === '工場出荷')
      || (a.start_date || '9999').localeCompare(b.start_date || '9999')
      || (a.sort_order || 0) - (b.sort_order || 0))
    .forEach(t => {
      const pn = String(t.project_number);
      const cols = currentProjects.filter(p => p.project_number === pn && machineMatches(p.link_machine, t.machine) && unitMatches(p.unit, t.unit));
      if (cols.length) cols.forEach(p => ganttTasks[`${pn}__${p.machine}`].push(t));
      else (ganttOther[pn] = ganttOther[pn] || []).push(t);
    });

  statusRows.forEach(s => {
    statusMap[`${s.project_number}__${s.machine}__${s.process_no}`] = {
      status: s.status, start_date: s.start_date, end_date: s.end_date,
      tantousha: s.tantousha, memo: s.memo,
    };
  });
}

// ユニットの照合。ユニットを決めていない列は機械の工程を全部、ユニットの列はそのユニットと ALL（空欄）の工程を入れる
function unitMatches(columnUnit, taskUnit) {
  if (!columnUnit) return true;
  const u = String(taskUnit || '').trim();
  return u === columnUnit || u === '' || u.toUpperCase() === 'ALL';
}

// DB から読み直して全画面を描き直す
async function refreshDisplay() {
  showLoading();
  try {
    await loadData();
  } catch (e) {
    console.error(e);
    alert('データを読み込めませんでした。ページを再読み込みしてください。\n' + (e.message || e));
  }

  computeStats();
  renderLamps();
  renderNavProjects();
  renderTaskPanel();
  if (currentView === 'gantt') showGantt(); // 他の画面のときは、ガントを開いたときに描き直される
  renderDock(); // 工程確認表の画面なら、表もここで描き直す

  hideLoading();
}

// ログイン中の人が編集できるか。閲覧のみの人には管理者メニュー（工番管理）を出さず、工程確認表・議事録は表示だけにする
async function setupEditPermission() {
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  canEdit = EDITORS.includes(String(user?.email || '').toLowerCase());
  document.getElementById('nav-admin').hidden = !canEdit; // 管理者メニューは管理者だけ
  document.body.classList.toggle('read-only', !canEdit);

  myName = '';
  if (user) {
    myName = M365Login.m365Name(user) || '';
    if (!myName) {
      try {
        const { data } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
        myName = data?.name || '';
      } catch (_) { /* 読めなければ「自分の担当」は使えない */ }
    }
  }
}

async function init() {
  applyNavCompact();
  await setupEditPermission();
  await loadMinutesList();
  await refreshDisplay();
}

init();
