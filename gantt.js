// ─── ガントチャート（メイン画面） ─────────────────────────
// 工番 → 機種 → 全体工程表の電気関係タスク の順に上から並べる（対象は config.js の GANTT_MAJOR_ITEMS / GANTT_EXTRA_TEXTS）
// 帯の日付は全体工程表のまま（ここでは変えない）。完了のチェックは全体工程表のタスクの完了と同じもの
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
    { name: 'done_check', label: '完了', width: 40, align: 'center', template: ganttCheckCell },
    { name: 'text', label: '工番 / 機種 / 工程', width: 220, tree: true },
    { name: 'start_disp', label: '開始', width: 66, align: 'center',
      template: t => t.rowType === 'item' ? fmtDate(t.start_date_str) : '' },
    { name: 'end_disp', label: '終了', width: 66, align: 'center',
      template: t => t.rowType === 'item' ? fmtDate(t.end_date_str || t.start_date_str) : '' },
    { name: 'tasklist_disp', label: 'タスク', width: 52, align: 'center',
      template: t => t.tasklistText || '' },
  ];

  gantt.templates.grid_row_class = (start, end, task) =>
    'grid-' + task.rowType + (task.completed ? ' grid-done' : '');
  gantt.templates.task_row_class = (start, end, task) => 'row-' + task.rowType;
  gantt.templates.task_class = (start, end, task) => {
    if (task.rowType === 'project') return 'gantt-project';
    if (task.rowType === 'machine') return 'gantt-machine';
    return (task.isShip ? 'gantt-ship' : `gantt-dept-${task.barClass}`) + (task.completed ? ' gantt-done' : '');
  };
  gantt.templates.task_text = (start, end, task) => task.rowType === 'item' ? escapeHtml(task.text) : '';
  // 土日と今日の列に色を付ける（同梱の無料版には「今日」の線を引く機能が無いため、列の色で示す）
  const cellClass = date => {
    if (isTodayCell(date)) return 'today';
    return currentZoom === 'day' && (date.getDay() === 0 || date.getDay() === 6) ? 'weekend' : '';
  };
  gantt.templates.timeline_cell_class = (task, date) => cellClass(date);
  gantt.templates.scale_cell_class = date => cellClass(date);

  gantt.templates.tooltip_text = (start, end, task) => {
    if (task.rowType !== 'item') return `<b>${escapeHtml(task.text)}</b>`;
    const period = task.start_date_str
      ? `${fmtDate(task.start_date_str)}～${fmtDate(task.end_date_str || task.start_date_str)}` : '未定';
    return `<b>${escapeHtml(task.tooltipTitle)}</b><br>` +
      `大項目: ${escapeHtml(task.majorItem || '─')}<br>` +
      `予定: ${period}<br>` +
      `状態: ${task.completed ? '完了' : '未完了'}`;
  };

  // 完了欄のチェックを押したとき
  gantt.attachEvent('onTaskClick', (id, e) => {
    if (e.target && e.target.classList && e.target.classList.contains('gantt-check')) {
      toggleGanttDone(id);
      return false;
    }
    return true;
  });
  gantt.attachEvent('onBeforeLightbox', () => false);
  gantt.init('gantt-container');
}

function escapeHtml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s ?? '').replace(/[&<>"']/g, c => map[c]);
}

// 完了欄: 工程の行はチェック（編集できない人は ✓ だけ）
function ganttCheckCell(t) {
  if (t.rowType !== 'item') return '';
  if (!canEdit) return t.completed ? '✓' : '';
  return `<input type="checkbox" class="gantt-check" ${t.completed ? 'checked' : ''} title="全体工程表のタスクの完了">`;
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

function barClassOf(t) {
  if (GANTT_BAR_CLASS[t.major_item]) return GANTT_BAR_CLASS[t.major_item];
  return t.text.includes('試運転') ? 'sosou' : 'other';
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
    tasks.push({ id: mid, parent: pid, rowType: 'machine', text: proj.machine || '(機種なし)',
                 tasklistText: `${pr.done}/${pr.total}`, open: true });

    (ganttTasks[`${pn}__${proj.machine}`] || []).forEach(t => {
      // 同じ機種に同じ名前の工程が複数あるときはユニットで区別する（例: 電気艤装（PR））
      const label = t.unit && t.unit !== 'ALL' ? `${t.text}（${t.unit}）` : t.text;
      const item = {
        id: `${mid}__${t.id}`, parent: mid, rowType: 'item', taskId: t.id,
        text: label, tooltipTitle: `${pn} ${proj.machine}　${label}`, majorItem: t.major_item,
        isShip: t.text === '工場出荷', barClass: barClassOf(t), completed: !!t.is_completed,
        start_date_str: t.start_date, end_date_str: t.end_date,
      };
      if (t.start_date) Object.assign(item, { start_date: t.start_date, duration: ganttDuration(t.start_date, t.end_date) });
      else item.unscheduled = true;
      tasks.push(item);
    });
  });

  // 工番・機種の行の期間は、配下の帯の最初から最後まで。配下に帯が無ければ行だけ出す
  const span = parentId => {
    const ranges = tasks.filter(t => t.parent === parentId).flatMap(k => k.rowType === 'item'
      ? (k.start_date_str ? [[k.start_date_str, k.end_date_str || k.start_date_str]] : [])
      : (k.start_date ? [[k.start_date, k.end_str]] : []));
    if (!ranges.length) return null;
    return { start: ranges.map(r => r[0]).sort()[0], end: ranges.map(r => r[1]).sort().at(-1) };
  };
  [...tasks.filter(t => t.rowType === 'machine'), ...tasks.filter(t => t.rowType === 'project')].forEach(t => {
    const s = span(t.id);
    if (s) {
      Object.assign(t, { start_date: s.start, end_str: s.end, duration: ganttDuration(s.start, s.end),
                         type: gantt.config.types.project });
    } else {
      t.unscheduled = true;
    }
  });

  return { data: tasks, links: [] };
}

// 完了のチェックを付け外しする（全体工程表のタスクの is_completed を書き換える）
async function toggleGanttDone(ganttId) {
  if (!canEdit) return;
  const task = gantt.getTask(ganttId);
  const next = !task.completed;
  const msg = `${task.tooltipTitle}\nを${next ? '完了にします' : '未完了に戻します'}か？\n（全体工程表のタスクも${next ? '完了' : '未完了'}になります）`;
  if (!confirm(msg)) { gantt.refreshTask(ganttId); return; }

  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  const name = user ? (M365Login.m365Name(user) || String(user.email || '').split('@')[0]) : '';
  const { data, error } = await sb.from('tasks')
    .update(Object.assign({ is_completed: next }, name ? { last_updated_by: name } : {}))
    .eq('id', task.taskId).select('id');
  if (error || !data.length) {
    alert('保存できませんでした。ログインが切れている場合は、ページを再読み込みしてください。\n' + (error ? error.message : '権限がないか、ログインが切れています'));
    gantt.refreshTask(ganttId);
    return;
  }

  // 同じタスクを複数の列（例: FS と FSBT1）で表示していることがあるので、全部そろえる
  Object.values(ganttTasks).flat().filter(t => t.id === task.taskId).forEach(t => { t.is_completed = next; });
  gantt.eachTask(t => {
    if (t.taskId === task.taskId) { t.completed = next; gantt.refreshTask(t.id); }
  });
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
