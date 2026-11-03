// ─── ガントチャート（メイン画面） ─────────────────────────
// 工番 → 機械 → 全体工程表の電気関係タスク の順に上から並べる（対象は config.js の isElectricalTask）
// 帯の日付は全体工程表のまま（ここでは変えない）。完了のチェックは全体工程表のタスクの完了と同じもの
const DAY_SCALES = [
  { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
  { unit: 'day',   step: 1, format: d => `${d.getDate()}`, css: d => scaleCellClass(d) },
  { unit: 'day',   step: 1, format: d => '日月火水木金土'[d.getDay()], css: d => scaleCellClass(d) },
];
const WEEK_SCALES = [
  { unit: 'month', step: 1, format: d => `${d.getFullYear()}/${d.getMonth()+1}` },
  { unit: 'week',  step: 1, format: d => `${d.getMonth()+1}/${d.getDate()}～`, css: d => scaleCellClass(d) },
];
// 目盛り（日付・曜日）の色。今日は赤背景に白字、土日は薄い灰色（月の行には付けない）
function scaleCellClass(date) {
  if (isTodayCell(date)) return 'today';
  return currentZoom === 'day' && (date.getDay() === 0 || date.getDay() === 6) ? 'weekend' : '';
}
let currentZoom = 'day';
let barMode = localStorage.getItem('denki_bar_mode') === 'dept' ? 'dept' : 'status'; // 帯の色: 状態 / 部署
const ganttOpen = {};   // 工番・機械の行の開閉（描き直しても保つ）
const ganttFilters = { late: false, soon: false, hideDone: false, mine: false, pns: new Set(), depts: new Set() };
let ganttVisible = null; // 絞り込みで表示する行の id。null なら全部

function initGantt() {
  gantt.config.readonly = true;
  gantt.config.date_format = '%Y-%m-%d';
  gantt.config.scale_height = 54;
  gantt.config.row_height   = 26;
  gantt.config.bar_height   = 16;
  gantt.config.min_column_width = 26;
  gantt.config.scales = DAY_SCALES;
  gantt.config.show_unscheduled = true;
  gantt.config.details_on_dblclick = false;

  gantt.config.columns = [
    { name: 'done_check', label: '完了', width: 40, align: 'center', template: ganttCheckCell },
    { name: 'text', label: '工番 / 機械 / 工程', width: 250, tree: true, template: ganttTextCell },
    { name: 'start_disp', label: '開始', width: 60, align: 'center',
      template: t => t.rowType === 'item' ? fmtMD(t.start_date_str) : '' },
    { name: 'end_disp', label: '終了', width: 60, align: 'center', template: ganttEndCell },
    { name: 'tasklist_disp', label: 'タスク', width: 62, align: 'center', template: ganttTaskCell },
  ];
  // 左側の表の幅は列の合計にする（初期値 360px のままだと列が押し縮められて文字が切れる）
  gantt.config.grid_width = gantt.config.columns.reduce((sum, c) => sum + c.width, 0);

  gantt.templates.grid_row_class = (start, end, task) => ganttRowClass(task);
  gantt.templates.task_row_class = (start, end, task) => 'row-' + task.rowType + (isRelRow(task) ? ' row-rel' : '');
  gantt.templates.task_class = (start, end, task) => ganttBarClass(task);
  // 短い帯は中に文字が入らないので、帯の右横に出す
  gantt.templates.task_text = (start, end, task) =>
    task.rowType === 'item' && !isShortBar(start, end) ? escapeHtml(task.text) : '';
  gantt.templates.rightside_text = (start, end, task) =>
    task.rowType === 'item' && isShortBar(start, end) ? escapeHtml(task.text) : '';
  // 土日と今日の列に色を付ける（同梱の無料版には「今日」の線を引く機能が無いため、列の色で示す）
  const cellClass = date => {
    if (isTodayCell(date)) return 'today';
    return currentZoom === 'day' && (date.getDay() === 0 || date.getDay() === 6) ? 'weekend' : '';
  };
  gantt.templates.timeline_cell_class = (task, date) => cellClass(date);

  // 完了欄のチェックを押したら完了の付け外し。開閉の三角はそのまま。それ以外で行を押したら右側にタスクリスト
  gantt.attachEvent('onTaskClick', (id, e) => {
    const tgt = e.target;
    if (tgt && tgt.classList && tgt.classList.contains('gantt-check')) {
      toggleGanttDone(id);
      return false;
    }
    if (tgt && tgt.closest && tgt.closest('.gantt_tree_icon')) return true;
    onGanttRowClick(id);
    return true;
  });
  gantt.attachEvent('onTaskOpened', id => { ganttOpen[id] = true; });
  gantt.attachEvent('onTaskClosed', id => { ganttOpen[id] = false; });
  gantt.attachEvent('onBeforeTaskDisplay', id => !ganttVisible || ganttVisible.has(id));
  gantt.attachEvent('onBeforeLightbox', () => false);
  gantt.init('gantt-container');
}

function isShortBar(start, end) {
  if (!start || !end) return false;
  return gantt.posFromDate(end) - gantt.posFromDate(start) < 90;
}

function deptKeyOf(t) {
  return t.isShip ? 'ship' : t.barClass;
}

// 右のタスクリストで強調している工程の行
function isRelRow(t) {
  return !!(panelCol && panelCol.rel && panelCol.rel.ganttId === t.id);
}

function ganttRowClass(t) {
  const cls = ['grid-' + t.rowType];
  if (t.completed) cls.push('grid-done');
  if (isRelRow(t)) cls.push('row-rel');
  if (t.rowType === 'machine' && t.col && panelCol
      && t.col.project_number === panelCol.project_number && t.col.machine === panelCol.machine) cls.push('row-sel');
  if (t.rowType === 'project' && t.pn === selectedPn) cls.push('row-sel');
  return cls.join(' ');
}

function ganttBarClass(t) {
  if (t.rowType === 'project') return 'gantt-project';
  if (t.rowType === 'machine') return 'gantt-machine';
  if (barMode === 'status') return 'bar-st-' + t.state;
  let c = t.isShip ? 'gantt-ship' : `gantt-dept-${t.barClass}`;
  if (t.state === 'done') c += ' gantt-done';
  else if (t.state === 'late') c += ' bar-ol-late';
  else if (t.state === 'soon') c += ' bar-ol-soon';
  return c;
}

// 完了欄: 工程の行はチェック（編集できない人は ✓ だけ）
function ganttCheckCell(t) {
  if (t.rowType !== 'item') return '';
  if (!canEdit) return t.completed ? '✓' : '';
  return `<input type="checkbox" class="gantt-check" ${t.completed ? 'checked' : ''} title="全体工程表のタスクの完了">`;
}

// 工程の行: 部署の色の細い線（状態の色のとき）＋工程名＋担当者
function ganttTextCell(t) {
  if (t.rowType !== 'item') return escapeHtml(t.text);
  const owner = t.owner ? `<span class="g-owner">${escapeHtml(t.owner)}</span>` : '';
  return `<span class="ds ds-${deptKeyOf(t)}"></span>${escapeHtml(t.text)}${owner}`;
}

function ganttEndCell(t) {
  if (t.rowType !== 'item') return '';
  return `<span class="end-${t.state}">${fmtMD(t.end_date_str || t.start_date_str)}</span>`;
}

// タスク欄: 機械の行はタスクリスト全体の完了数。工程の行はその工程に必要な項目の完了数（全部完了なら「完了可」）
function ganttTaskCell(t) {
  if (t.rowType === 'machine' && t.col) {
    const pr = progressOf(t.col);
    return `${pr.done}/${pr.total}`;
  }
  if (t.rowType !== 'item' || !t.col) return '';
  const rp = relProgress(t.col, t.rawText);
  if (!rp || !rp.total) return '';
  if (rp.done === rp.total && !t.completed) {
    return '<span class="ready-badge" title="タスクリストの該当タスクがすべて完了しています">完了可</span>';
  }
  return `<span class="g-rel">${rp.done}/${rp.total}</span>`;
}

// その列（日単位なら1日、週単位なら1週間）に今日が含まれるか
function isTodayCell(date) {
  const today = todayStart();
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
  const pns = [...new Set(currentProjects.map(p => p.project_number))];

  // 1行（機械）分の帯。同じ名前の工程が複数あるときだけユニットで区別する（例: 電気艤装（MU））
  const pushItems = (parentId, pn, col, rowLabel, list, showMachine) => {
    const count = {};
    list.forEach(t => { count[t.text] = (count[t.text] || 0) + 1; });
    list.forEach(t => {
      let label = count[t.text] > 1 && t.unit && t.unit !== 'ALL' ? `${t.text}（${t.unit}）` : t.text;
      if (showMachine) label = `[${t.machine || '機種なし'}] ${label}`;
      const item = {
        id: `${parentId}__${t.id}`, parent: parentId, rowType: 'item', taskId: t.id, pn, col,
        text: label, rawText: t.text, fullTitle: `${rowLabel}　${label}`, majorItem: t.major_item,
        owner: t.owner || '', state: taskState(t),
        isShip: t.text === '工場出荷', barClass: barClassOf(t), completed: !!t.is_completed,
        start_date_str: t.start_date, end_date_str: t.end_date,
      };
      if (t.start_date) Object.assign(item, { start_date: t.start_date, duration: ganttDuration(t.start_date, t.end_date) });
      else item.unscheduled = true;
      tasks.push(item);
    });
  };

  pns.forEach(pn => {
    const cols = currentProjects.filter(p => p.project_number === pn);
    const pid = `p_${pn}`;
    tasks.push({ id: pid, rowType: 'project', pn, text: `${pn}　${cols[0].customer_name || ''}`, open: ganttOpen[pid] !== false });

    cols.forEach(proj => {
      const mid = `m_${pn}__${proj.machine}`;
      tasks.push({ id: mid, parent: pid, rowType: 'machine', pn, text: proj.machine || '(機種なし)', col: proj,
                   open: ganttOpen[mid] !== false });
      pushItems(mid, pn, proj, `${pn} ${proj.machine}`, ganttTasks[`${pn}__${proj.machine}`] || [], false);
    });

    // どの列の機種にも合わない電気関係タスク（機種が空欄、列に無い機種など）
    const others = ganttOther[pn] || [];
    if (others.length) {
      const oid = `o_${pn}`;
      tasks.push({ id: oid, parent: pid, rowType: 'machine', pn, text: '工番共通・その他', isOther: true,
                   open: ganttOpen[oid] !== false });
      pushItems(oid, pn, null, pn, others, true);
    }
  });

  // 工番・機械の行の期間は、配下の帯の最初から最後まで。配下に帯が無ければ行だけ出す
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

// 行を押したとき: 右にその機械のタスクリスト、下の議事録欄をその工番のページ（その機械の欄を目立たせる）に切り替える
function onGanttRowClick(id) {
  const t = gantt.getTask(id);
  const pn = t.pn;
  selectedPn = pn;
  if (t.rowType === 'project') {
    const col = currentProjects.find(p => p.project_number === pn);
    if (col) openTaskPanel(pn, col.machine);
    setDockKey(pn);
  } else if (t.rowType === 'machine') {
    if (t.col) { openTaskPanel(pn, t.col.machine); setDockKey(pn, t.col.machine); }
    else setDockKey(pn, ''); // 工番共通・その他
  } else if (t.col) {
    const m = processMapOf(t.rawText);
    openTaskPanel(pn, t.col.machine, m ? { label: t.text, nos: m.nos, ganttId: id } : null);
    setDockKey(pn, t.col.machine);
  } else {
    setDockKey(pn, '');
  }
  renderNavProjects();
}

// タスクリストのステータスを変えたとき、その機械の行と工程の行の「タスク」欄を更新する
function updateGanttProgress(proj) {
  if (!ganttInitialized) return;
  gantt.eachTask(t => {
    if (t.col && t.col.project_number === proj.project_number && t.col.machine === proj.machine) gantt.refreshTask(t.id);
  });
}

// 完了のチェックを付け外しする（全体工程表のタスクの is_completed を書き換える）
async function toggleGanttDone(ganttId) {
  if (!canEdit) return;
  const task = gantt.getTask(ganttId);
  const next = !task.completed;
  const msg = `${task.fullTitle}\nを${next ? '完了にします' : '未完了に戻します'}か？\n（全体工程表のタスクも${next ? '完了' : '未完了'}になります）`;
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
  [...Object.values(ganttTasks), ...Object.values(ganttOther)].flat()
    .filter(t => t.id === task.taskId).forEach(t => { t.is_completed = next; });
  gantt.eachTask(t => {
    if (t.taskId === task.taskId) {
      t.completed = next;
      t.state = taskState({ is_completed: next, start_date: t.start_date_str, end_date: t.end_date_str });
    }
  });
  computeStats();
  renderLamps();
  renderNavProjects();
  applyGanttFilters();
}

// ─── 絞り込み ─────────────────────────────────────────
function hasItemFilter() {
  const f = ganttFilters;
  return f.late || f.soon || f.hideDone || f.mine || f.depts.size > 0;
}

function applyGanttFilters() {
  if (!ganttInitialized) return;
  const f = ganttFilters;
  const itemFilter = hasItemFilter();
  if (!itemFilter && !f.pns.size) {
    ganttVisible = null;
  } else {
    const vis = new Set();
    gantt.eachTask(t => {
      if (t.rowType !== 'item') return;
      if (f.pns.size && !f.pns.has(t.pn)) return;
      if ((f.late || f.soon) && !((f.late && t.state === 'late') || (f.soon && t.state === 'soon'))) return;
      if (f.hideDone && t.completed) return;
      if (f.mine && !ownerMatchesMe(t.owner)) return;
      if (f.depts.size && !f.depts.has(deptKeyOf(t))) return;
      vis.add(t.id);
      vis.add(t.parent);
      vis.add(gantt.getTask(t.parent).parent);
    });
    // 工番だけで絞り込んだときは、帯の無い機械の行も出す
    if (!itemFilter) gantt.eachTask(t => { if (t.rowType !== 'item' && f.pns.has(t.pn)) vis.add(t.id); });
    ganttVisible = vis;
  }
  gantt.render();
  document.getElementById('gantt-empty').hidden = !(ganttVisible && ganttVisible.size === 0);
  renderFilterBar();
  renderLamps();
}

function renderFilterBar() {
  const f = ganttFilters;
  document.querySelectorAll('#gantt-filters [data-filter]').forEach(b => {
    b.classList.toggle('on', !!f[b.dataset.filter]);
  });
  const mine = document.querySelector('#gantt-filters [data-filter="mine"]');
  mine.disabled = !myName;
  mine.title = myName ? `全体工程表の担当者に「${myName}」が含まれる工程` : 'ログイン中の人の名前が取得できないため使えません';

  const mkChip = (label, on, onClick, sw) => {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.innerHTML = (sw ? `<span class="chip-sw ${sw}"></span>` : '') + escapeHtml(label);
    b.addEventListener('click', onClick);
    return b;
  };
  const pnBox = document.getElementById('filter-pns');
  pnBox.innerHTML = '';
  [...new Set(currentProjects.map(p => p.project_number))].forEach(pn => {
    pnBox.appendChild(mkChip(pn, f.pns.has(pn), () => {
      if (f.pns.has(pn)) f.pns.delete(pn); else f.pns.add(pn);
      applyGanttFilters();
    }));
  });
  const dpBox = document.getElementById('filter-depts');
  dpBox.innerHTML = '';
  DEPT_FILTERS.forEach(d => {
    dpBox.appendChild(mkChip(d.label, f.depts.has(d.key), () => {
      if (f.depts.has(d.key)) f.depts.delete(d.key); else f.depts.add(d.key);
      applyGanttFilters();
    }, 'sw-' + d.key));
  });
  document.getElementById('filter-clear').hidden = !(hasItemFilter() || f.pns.size);
}

document.querySelectorAll('#gantt-filters [data-filter]').forEach(b => {
  b.addEventListener('click', () => {
    const k = b.dataset.filter;
    ganttFilters[k] = !ganttFilters[k];
    applyGanttFilters();
  });
});
document.getElementById('filter-clear').addEventListener('click', () => {
  Object.assign(ganttFilters, { late: false, soon: false, hideDone: false, mine: false });
  ganttFilters.pns.clear();
  ganttFilters.depts.clear();
  applyGanttFilters();
});

// ─── 帯の色・凡例 ─────────────────────────────────────
function renderGanttLegend() {
  const items = barMode === 'status'
    ? [['進行中', 'lg-active'], ['予定', 'lg-plan'], ['注意', 'lg-soon'], ['遅れ', 'lg-late'], ['完了', 'lg-done']]
    : [['電技', 'lg-denki'], ['電装', 'lg-denso'], ['試運転', 'lg-sosou'], ['工場出荷', 'lg-ship'],
       ['注意（黄枠）', 'lg-ol-soon'], ['遅れ（赤枠）', 'lg-ol-late'], ['完了', 'lg-done']];
  document.getElementById('gantt-legend').innerHTML =
    items.map(([label, cls]) => `<span class="legend-item"><span class="legend-box ${cls}"></span>${label}</span>`).join('')
    + '<span class="legend-item"><span class="ready-badge">完了可</span>タスクリストが全部完了</span>';
  document.getElementById('bar-status').classList.toggle('active', barMode === 'status');
  document.getElementById('bar-dept').classList.toggle('active', barMode === 'dept');
  document.body.classList.toggle('bar-status', barMode === 'status');
}

function setBarMode(mode) {
  barMode = mode;
  localStorage.setItem('denki_bar_mode', mode);
  renderGanttLegend();
  if (ganttInitialized) gantt.render();
}
document.getElementById('bar-status').addEventListener('click', () => setBarMode('status'));
document.getElementById('bar-dept').addEventListener('click', () => setBarMode('dept'));

// ─── 開閉 ─────────────────────────────────────────────
function setAllOpen(fn) {
  if (!ganttInitialized) return;
  gantt.eachTask(t => {
    if (t.rowType === 'item') return;
    const open = fn(t);
    if (open === null) return;
    t.$open = open;
    ganttOpen[t.id] = open;
  });
  gantt.render();
}
document.getElementById('btn-expand').addEventListener('click', () => setAllOpen(() => true));
document.getElementById('btn-collapse').addEventListener('click', () => setAllOpen(t => t.rowType === 'project' ? false : null));

function scrollGanttToProject(pn) {
  if (!ganttInitialized) return;
  const id = `p_${pn}`;
  if (!gantt.isTaskExists(id)) return;
  if (ganttVisible && !ganttVisible.has(id)) { ganttFilters.pns.clear(); ganttFilters.pns.add(pn); applyGanttFilters(); }
  const t = gantt.getTask(id);
  if (!t.$open) { t.$open = true; ganttOpen[id] = true; gantt.render(); }
  gantt.scrollTo(null, gantt.getTaskTop(id));
}

// ─── 表示 ─────────────────────────────────────────────
function showGantt() {
  if (!ganttInitialized) {
    try {
      initGantt();
      ganttInitialized = true;
    } catch(e) {
      console.error('[Gantt] initGantt ERROR:', e);
      return;
    }
  }
  renderGanttLegend();

  gantt.clearAll();
  const data = buildGanttData();
  if (data.data.length > 0) {
    gantt.parse(data);
    applyGanttFilters();
    gantt.setSizes();
    gantt.showDate(new Date());
  } else {
    gantt.render();
    renderFilterBar();
  }
}

function resizeGantt() {
  if (ganttInitialized && currentView === 'gantt') gantt.setSizes();
}

// ─── 上部バーの日単位・週単位・今日へ ─────────────────
function setZoom(unit) {
  currentZoom = unit;
  document.getElementById('zoom-day').classList.toggle('active', unit === 'day');
  document.getElementById('zoom-week').classList.toggle('active', unit === 'week');
  gantt.config.scales = unit === 'day' ? DAY_SCALES : WEEK_SCALES;
  gantt.config.scale_height = unit === 'day' ? 54 : 36;
  gantt.render();
}

document.getElementById('zoom-day').addEventListener('click',  () => setZoom('day'));
document.getElementById('zoom-week').addEventListener('click', () => setZoom('week'));
document.getElementById('btn-today').addEventListener('click', () => gantt.showDate(new Date()));
window.addEventListener('resize', resizeGantt);
