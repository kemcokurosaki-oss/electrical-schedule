// ─── タブ切替 ────────────────────────────────────────────
let currentView = 'gantt';

function showView(name) {
  currentView = name;
  ['gantt', 'tasklist', 'minutes'].forEach(v => {
    document.getElementById('tab-' + v).classList.toggle('active', v === name);
    document.getElementById('view-' + v).classList.toggle('active', v === name);
  });
  if (name === 'gantt') setTimeout(() => showGantt(), 50);
  if (name === 'minutes') showMinutes();
}

document.getElementById('tab-gantt').addEventListener('click',    () => showView('gantt'));
document.getElementById('tab-tasklist').addEventListener('click', () => showView('tasklist'));
document.getElementById('tab-minutes').addEventListener('click',  () => showView('minutes'));

// ─── データ読み込み ───────────────────────────────────
async function loadData() {
  const [completedRes, colRes] = await Promise.all([
    sb.from('completed_projects').select('project_number'),
    sb.from('denki_columns').select('project_number, machine, link_machine, sort_order'),
  ]);
  if (completedRes.error) throw completedRes.error;
  if (colRes.error) throw colRes.error;
  const completedNums = new Set((completedRes.data || []).map(c => String(c.project_number)));

  currentProjects = colRes.data
    .filter(c => !completedNums.has(String(c.project_number)))
    .map(c => ({ project_number: String(c.project_number), machine: c.machine,
                 link_machine: c.link_machine || c.machine, sort_order: c.sort_order }))
    .sort((a, b) => a.project_number.localeCompare(b.project_number) || a.sort_order - b.sort_order);

  ganttTasks = {}; statusMap = {};
  if (currentProjects.length === 0) return;

  const projectNumbers = [...new Set(currentProjects.map(p => p.project_number))];
  const ganttFilter = `major_item.in.(${GANTT_MAJOR_ITEMS.join(',')}),text.in.(${GANTT_EXTRA_TEXTS.join(',')})`;

  const [tasks, custRows, statusRows] = await Promise.all([
    fetchAll(() => sb.from('tasks')
      .select('id, project_number, machine, unit, text, major_item, start_date, end_date, is_completed, is_archived, sort_order')
      .in('project_number', projectNumbers).or(ganttFilter).order('id')),
    fetchAll(() => sb.from('tasks')
      .select('project_number, customer_name')
      .in('project_number', projectNumbers).not('customer_name', 'is', null).order('id')),
    fetchAll(() => sb.from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, tantousha, memo')
      .in('project_number', projectNumbers).order('project_number').order('machine').order('process_no')),
  ]);

  // 工番＋機種ごとの全体工程表の電気関係タスク（開始日の早い順。工場出荷は最後）
  const tasksByMachine = {};
  tasks
    .filter(t => !t.is_archived)
    .sort((a, b) => (a.text === '工場出荷') - (b.text === '工場出荷')
      || (a.start_date || '9999').localeCompare(b.start_date || '9999')
      || (a.sort_order || 0) - (b.sort_order || 0))
    .forEach(t => {
      const k = `${t.project_number}__${t.machine || ''}`;
      (tasksByMachine[k] = tasksByMachine[k] || []).push(t);
    });
  currentProjects.forEach(proj => {
    ganttTasks[`${proj.project_number}__${proj.machine}`] =
      tasksByMachine[`${proj.project_number}__${proj.link_machine}`] || [];
  });

  const custMap = {};
  custRows.forEach(t => {
    if (t.customer_name && !custMap[t.project_number]) custMap[t.project_number] = t.customer_name;
  });
  currentProjects.forEach(p => { p.customer_name = custMap[p.project_number] || ''; });

  statusRows.forEach(s => {
    statusMap[`${s.project_number}__${s.machine}__${s.process_no}`] = {
      status: s.status, start_date: s.start_date, end_date: s.end_date,
      tantousha: s.tantousha, memo: s.memo,
    };
  });
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

  renderTaskList();
  if (currentView === 'gantt') showGantt(); // 他の画面のときは、ガントを開いたときに描き直される

  hideLoading();
}

// ログイン中の人が編集できるか。閲覧のみの人には工番管理を出さず、タスクリスト・議事録は表示だけにする
async function setupEditPermission() {
  const { data: { session } } = await sb.auth.getSession();
  canEdit = EDITORS.includes(String(session?.user?.email || '').toLowerCase());
  document.getElementById('btn-manage').style.display = canEdit ? '' : 'none';
  document.body.classList.toggle('read-only', !canEdit);
}

async function init() {
  await setupEditPermission();
  await refreshDisplay();
}

init();
