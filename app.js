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

  linkedMap = {}; shipMap = {}; statusMap = {};
  if (currentProjects.length === 0) return;

  const projectNumbers = [...new Set(currentProjects.map(p => p.project_number))];
  const taskTexts = [...PROCESSES.flatMap(p => p.taskTexts || []), '工場出荷'];

  const [tasks, custRows, statusRows] = await Promise.all([
    fetchAll(() => sb.from('tasks')
      .select('id, project_number, machine, text, start_date, end_date, status, is_completed')
      .in('project_number', projectNumbers).in('text', taskTexts).order('id')),
    fetchAll(() => sb.from('tasks')
      .select('project_number, customer_name')
      .in('project_number', projectNumbers).not('customer_name', 'is', null).order('id')),
    fetchAll(() => sb.from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, tantousha, memo')
      .in('project_number', projectNumbers).order('project_number').order('machine').order('process_no')),
  ]);

  // 工番＋機種ごとのタスク（開始日の早い順）
  const tasksByMachine = {};
  tasks
    .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'))
    .forEach(t => {
      const k = `${t.project_number}__${t.machine || ''}`;
      (tasksByMachine[k] = tasksByMachine[k] || []).push(t);
    });

  currentProjects.forEach(proj => {
    const ts = tasksByMachine[`${proj.project_number}__${proj.link_machine}`] || [];
    shipMap[`${proj.project_number}__${proj.machine}`] =
      ts.filter(t => t.text === '工場出荷' && t.start_date).map(t => t.start_date);
    PROCESSES.filter(p => p.linked).forEach(proc => {
      for (const text of proc.taskTexts) {
        const t = ts.find(t => t.text === text);
        if (t) {
          linkedMap[procKey(proj, proc)] = {
            id: t.id, start_date: t.start_date, end_date: t.end_date,
            completed: !!t.is_completed || t.status === '完了',
          };
          break;
        }
      }
    });
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
