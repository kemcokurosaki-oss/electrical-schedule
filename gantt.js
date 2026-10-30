// ─── ガントチャート（メイン画面） ─────────────────────────
// 工番 → 機種 → 項目 の順に上から並べる。帯の日付は全体工程表の予定（連携項目と工場出荷）。閲覧専用
const DAY_SCALES = [
  { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
  { unit: 'day',   step: 1, format: d => `${d.getDate()}` },
  { unit: 'day',   step: 1, format: d => '日月火水木金土'[d.getDay()] },
];
const WEEK_SCALES = [
  { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
  { unit: 'week',  step: 1, format: d => `${d.getMonth()+1}/${d.getDate()}～` },
];
let currentZoom = 'day';

function initGantt() {
  gantt.plugins({ tooltip: true });
  gantt.config.readonly = true;
  gantt.config.date_format = '%Y-%m-%d';
  gantt.config.scale_height = 54;
  gantt.config.row_height   = 24;
  gantt.config.bar_height   = 16;
  gantt.config.min_column_width = 26;
  gantt.config.scales = DAY_SCALES;
  gantt.config.show_unscheduled = true;
  gantt.config.details_on_dblclick = false;

  gantt.config.columns = [
    { name: 'text', label: '工番 / 機種 / 項目', width: 230, tree: true },
    { name: 'progress_disp', label: '完了', width: 56, align: 'center',
      template: t => t.progressText || '' },
    { name: 'start_disp', label: '開始', width: 70, align: 'center',
      template: t => t.rowType === 'item' ? fmtDate(t.start_date_str) : '' },
    { name: 'end_disp', label: '終了', width: 70, align: 'center',
      template: t => t.rowType === 'item' ? fmtDate(t.end_date_str || t.start_date_str) : '' },
  ];

  gantt.templates.grid_row_class = (start, end, task) => 'grid-' + task.rowType;
  gantt.templates.task_row_class = (start, end, task) => 'row-' + task.rowType;
  gantt.templates.task_class = (start, end, task) => {
    if (task.rowType === 'project') return 'gantt-project';
    if (task.rowType === 'machine') return 'gantt-machine';
    if (task.isShip) return 'gantt-ship';
    return `gantt-dept-${task.deptClass}` + ({ '完了': ' gantt-done', '対象外': ' gantt-na' }[task.statusLabel] || '');
  };
  gantt.templates.task_text = (start, end, task) => task.rowType === 'item' ? (task.statusLabel || '') : '';
  // 土日と今日の列に色を付ける（同梱の無料版には「今日」の線を引く機能が無いため、列の色で示す）
  const cellClass = date => {
    if (isTodayCell(date)) return 'today';
    return currentZoom === 'day' && (date.getDay() === 0 || date.getDay() === 6) ? 'weekend' : '';
  };
  gantt.templates.timeline_cell_class = (task, date) => cellClass(date);
  gantt.templates.scale_cell_class = date => cellClass(date);

  gantt.templates.tooltip_text = (start, end, task) => {
    if (task.rowType !== 'item') return `<b>${task.text}</b>`;
    return `<b>${task.tooltipTitle}</b><br>` +
      `全体工程表: ${task.taskText}<br>` +
      `予定: ${fmtDate(task.start_date_str)}～${fmtDate(task.end_date_str || task.start_date_str)}<br>` +
      `状態: ${task.statusLabel || '─'}`;
  };

  gantt.attachEvent('onBeforeLightbox', () => false);
  gantt.init('gantt-container');
}

// その列（日単位なら1日、週単位なら1週間）に今日が含まれるか
function isTodayCell(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setDate(end.getDate() + (currentZoom === 'day' ? 1 : 7));
  return date <= today && today < end;
}

function ganttDuration(startDate, endDate) {
  return endDate
    ? Math.max(1, Math.round((parseLocalDate(endDate) - parseLocalDate(startDate)) / 86400000) + 1)
    : 1;
}

function buildGanttData() {
  const tasks = [];
  const projectIds = new Set();

  currentProjects.forEach(proj => {
    const pn = proj.project_number;
    const pid = `p_${pn}`;
    if (!projectIds.has(pid)) {
      projectIds.add(pid);
      tasks.push({ id: pid, rowType: 'project', text: `${pn}　${proj.customer_name || ''}`, open: true });
    }

    const mid = `m_${pn}__${proj.machine}`;
    const pr = progressOf(proj);
    const children = [];

    PROCESSES.filter(p => p.linked).forEach(proc => {
      const d = getProcData(proj, proc);
      if (!d.start_date) return;
      children.push({
        id: `${mid}__${proc.no}`, parent: mid, rowType: 'item',
        text: `${proc.no}. ${proc.name}`, tooltipTitle: `${pn} ${proj.machine}　${proc.no}. ${proc.name}`,
        taskText: linkedMap[procKey(proj, proc)] ? proc.taskTexts.join(' / ') : '',
        start_date: d.start_date, duration: ganttDuration(d.start_date, d.end_date),
        start_date_str: d.start_date, end_date_str: d.end_date,
        deptClass: PROCESS_DEPT[proc.no] || 'other', statusLabel: d.status,
      });
    });
    (shipMap[`${pn}__${proj.machine}`] || []).forEach((date, i) => {
      children.push({
        id: `${mid}__ship${i}`, parent: mid, rowType: 'item', isShip: true,
        text: '工場出荷', tooltipTitle: `${pn} ${proj.machine}　工場出荷`, taskText: '工場出荷',
        start_date: date, duration: 1, start_date_str: date, end_date_str: date,
      });
    });

    const machine = { id: mid, parent: pid, rowType: 'machine', text: proj.machine || '(機種なし)',
                      progressText: `${pr.done}/${pr.total}`, open: true };
    tasks.push(machine, ...children);
  });

  // 工番・機種の行の期間は、配下の帯の最初から最後まで。配下に帯が無ければ行だけ出す
  const span = parentId => {
    const kids = tasks.filter(t => t.parent === parentId);
    const ranges = kids.flatMap(k => k.rowType === 'item'
      ? [[k.start_date_str, k.end_date_str || k.start_date_str]]
      : (k.start_date ? [[k.start_date, k.end_str]] : []));
    if (!ranges.length) return null;
    const start = ranges.map(r => r[0]).sort()[0];
    const end = ranges.map(r => r[1]).sort().at(-1);
    return { start, end };
  };
  [...tasks.filter(t => t.rowType === 'machine'), ...tasks.filter(t => t.rowType === 'project')].forEach(t => {
    const s = span(t.id);
    if (s) {
      Object.assign(t, { start_date: s.start, end_str: s.end, duration: ganttDuration(s.start, s.end),
                         type: gantt.config.types.project });
      delete t.unscheduled;
    } else {
      delete t.type;
      t.unscheduled = true;
    }
  });

  return { data: tasks, links: [] };
}

function showGantt() {
  const container = document.getElementById('gantt-container');
  const toolbar   = document.getElementById('gantt-toolbar');
  container.style.height = (window.innerHeight - 44 - toolbar.offsetHeight) + 'px';

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
}

// ─── ガントツールバー ─────────────────────────────────
function setZoom(unit) {
  currentZoom = unit;
  ['zoom-day', 'zoom-week'].forEach(id => {
    document.getElementById(id).classList.toggle('zoom-active', id === `zoom-${unit}`);
  });
  gantt.config.scales = unit === 'day' ? DAY_SCALES : WEEK_SCALES;
  gantt.config.scale_height = unit === 'day' ? 54 : 36;
  gantt.render();
}

document.getElementById('zoom-day').addEventListener('click',  () => setZoom('day'));
document.getElementById('zoom-week').addEventListener('click', () => setZoom('week'));
document.getElementById('btn-today').addEventListener('click', () => gantt.showDate(new Date()));
window.addEventListener('resize', () => {
  if (ganttInitialized && document.getElementById('view-gantt').classList.contains('active')) {
    const toolbar = document.getElementById('gantt-toolbar');
    document.getElementById('gantt-container').style.height = (window.innerHeight - 44 - toolbar.offsetHeight) + 'px';
    gantt.setSizes();
  }
});
