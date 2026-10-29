// ─── ガントチャート ───────────────────────────────────
function initGantt() {
  gantt.plugins({ marker: true });
  gantt.config.date_format = '%Y-%m-%d';
  gantt.config.scale_height = 48;
  gantt.config.row_height   = 26;
  gantt.config.task_height  = 26;
  gantt.config.min_column_width = 27;
  gantt.config.fit_tasks = false;
  gantt.config.drag_move    = false;
  gantt.config.drag_resize  = false;
  gantt.config.drag_progress = false;
  gantt.config.details_on_dblclick = false;

  gantt.config.scales = [
    { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
    { unit: 'week',  step: 1, format: d => `${d.getDate()}` },
  ];

  gantt.config.columns = [
    { name: 'text',   label: '工番 / 機種 / 工程名', width: 230, tree: true },
    { name: 'owner',  label: '担当者', width: 90, align: 'center' },
    {
      name: 'start_disp', label: '開始日', width: 85, align: 'center',
      template: t => t.type === gantt.config.types.project ? '' : fmtDate(t.start_date_str || ''),
    },
    {
      name: 'end_disp', label: '終了日', width: 85, align: 'center',
      template: t => t.type === gantt.config.types.project ? '' : fmtDate(t.end_date_str || ''),
    },
  ];

  gantt.templates.task_class = (start, end, task) => {
    if (task.type === gantt.config.types.project) return 'gantt-project';
    return `gantt-dept-${task.deptClass || 'other'}`;
  };

  gantt.templates.task_text = (start, end, task) => {
    if (task.type === gantt.config.types.project) return '';
    return task.owner ? `<span style="font-size:10px">${task.owner}</span>` : '';
  };

  gantt.templates.tooltip_text = (start, end, task) => {
    if (task.type === gantt.config.types.project) return `<b>${task.text}</b>`;
    return `<b>${task.text}</b><br>` +
      `担当: ${task.owner || '─'}<br>` +
      `状態: ${task.statusLabel || '─'}<br>` +
      `開始: ${fmtDate(task.start_date_str || '')}<br>` +
      `終了: ${fmtDate(task.end_date_str || '')}`;
  };

  gantt.attachEvent('onBeforeLightbox', () => false);

  gantt.attachEvent('onTaskDblClick', (id) => {
    const task = gantt.getTask(id);
    if (!task || task.type === gantt.config.types.project) return false;
    const proj = currentProjects.find(p => String(p.project_number) === String(task.projNum) && p.machine === task.machine);
    const proc = PROCESSES.find(p => p.no === task.procNo);
    if (proj && proc) openPopup(proj, proc, id);
    return false;
  });

  gantt.init('gantt-container');
}

let todayMarkerId = null;
function updateTodayMarker() {
  if (todayMarkerId !== null) {
    try { gantt.deleteMarker(todayMarkerId); } catch(e) {}
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  todayMarkerId = gantt.addMarker({
    start_date: today,
    css:   'today-line',
    title: '今日',
  });
}

function ganttDuration(startDate, endDate) {
  return endDate
    ? Math.max(1, Math.round((parseLocalDate(endDate) - parseLocalDate(startDate)) / 86400000) + 1)
    : 1;
}

function ganttChild(parentId, proj, proc, d) {
  return {
    id:          `${parentId}__${proc.no}`,
    text:        `${proc.no}. ${proc.name}`,
    start_date:  d.start_date,
    duration:    ganttDuration(d.start_date, d.end_date),
    parent:      parentId,
    owner:       d.owner || '',
    statusLabel: d.status || '',
    deptClass:   PROCESS_DEPT[proc.no] || 'other',
    start_date_str: d.start_date,
    end_date_str:   d.end_date || null,
    projNum:  proj.project_number,
    machine:  proj.machine,
    procNo:   proc.no,
  };
}

function buildGanttData() {
  const tasks = [];

  currentProjects.forEach(proj => {
    const parentId = `${proj.project_number}__${proj.machine || ''}`;
    const children = [];

    PROCESSES.forEach(proc => {
      const d = getProcData(proj, proc);
      if (!d.start_date) return;
      children.push(ganttChild(parentId, proj, proc, d));
    });

    if (children.length === 0) return;

    const earliest = children.reduce((m, t) => t.start_date < m ? t.start_date : m, children[0].start_date);

    tasks.push({
      id:         parentId,
      text:       `${proj.project_number}　${proj.machine || ''}　${proj.customer_name || ''}`,
      start_date: earliest,
      duration:   1,
      type:       gantt.config.types.project,
      open:       false,
    });
    tasks.push(...children);
  });

  return { data: tasks, links: [] };
}

function showGantt() {
  const container = document.getElementById('gantt-container');
  const toolbar   = document.getElementById('gantt-toolbar');
  const h = window.innerHeight - 44 - toolbar.offsetHeight;
  container.style.height = h + 'px';

  if (!ganttInitialized) {
    try {
      initGantt();
      ganttInitialized = true;
    } catch(e) {
      console.error('[Gantt] initGantt ERROR:', e);
      return;
    }
  }

  gantt.clearAll();
  const data = buildGanttData();
  if (data.data.length > 0) {
    gantt.parse(data);
    gantt.showDate(new Date());
  } else {
    gantt.render();
  }
  updateTodayMarker();
}

// ─── ガントツールバー ─────────────────────────────────
let currentZoom = 'week';

function setZoom(unit) {
  currentZoom = unit;
  ['zoom-day', 'zoom-week'].forEach(id => {
    document.getElementById(id).classList.toggle('zoom-active', id === `zoom-${unit}`);
  });
  if (unit === 'day') {
    gantt.config.scales = [
      { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
      { unit: 'day',   step: 1, format: d => d.getDate() },
    ];
    gantt.config.min_column_width = 27;
  } else if (unit === 'week') {
    gantt.config.scales = [
      { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
      { unit: 'week',  step: 1, format: d => `${d.getDate()}` },
    ];
    gantt.config.min_column_width = 27;
  }
  gantt.render();
}

document.getElementById('zoom-day').addEventListener('click',  () => setZoom('day'));
document.getElementById('zoom-week').addEventListener('click', () => setZoom('week'));
document.getElementById('btn-today').addEventListener('click', () => gantt.showDate(new Date()));
