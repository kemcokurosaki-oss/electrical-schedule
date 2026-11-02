// ─── ガント横のタスクリスト（右側のパネル） ─────────────────
// ガントで機種（またはその下の工程）の行を押すと、その機種のタスクリストを右側に出して見比べられるようにする
let panelCol = null; // 表示中の列 { project_number, machine }

function openTaskPanel(pn, machine) {
  panelCol = { project_number: pn, machine };
  document.getElementById('view-gantt').classList.add('panel-open');
  renderTaskPanel();
  if (ganttInitialized) gantt.setSizes();
}

function closeTaskPanel() {
  panelCol = null;
  document.getElementById('view-gantt').classList.remove('panel-open');
  if (ganttInitialized) gantt.setSizes();
}

function renderTaskPanel() {
  if (!panelCol) return;
  const cols = currentProjects.filter(p => p.project_number === panelCol.project_number);
  const proj = cols.find(p => p.machine === panelCol.machine);
  if (!proj) { closeTaskPanel(); return; } // 工番管理で列を外したとき

  const panel = document.getElementById('tl-panel');
  const scrollTop = panel.scrollTop;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'tp-head';
  const title = document.createElement('span');
  title.className = 'tp-title';
  title.textContent = `${proj.project_number}　${proj.customer_name || ''}`;
  const close = document.createElement('button');
  close.className = 'tp-close';
  close.textContent = '×';
  close.title = '閉じる';
  close.addEventListener('click', closeTaskPanel);
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  // 同じ工番の機種を切り替えるボタン
  const machines = document.createElement('div');
  machines.className = 'tp-machines';
  cols.forEach(c => {
    const pr = progressOf(c);
    const b = document.createElement('button');
    b.className = 'tp-machine-btn' + (c === proj ? ' active' : '');
    b.textContent = `${c.machine || '(機種なし)'}　${pr.done}/${pr.total}`;
    b.addEventListener('click', () => openTaskPanel(c.project_number, c.machine));
    machines.appendChild(b);
  });
  panel.appendChild(machines);

  const table = document.createElement('table');
  table.className = 'tl-table tp-table';
  table.innerHTML = '<thead><tr><th class="tl-no">No.</th><th class="tl-name">項目</th><th class="tl-flow">流れ</th><th class="tl-machine"></th></tr></thead>';
  table.querySelector('th.tl-machine').textContent = proj.machine || '(機種なし)';
  const tbody = document.createElement('tbody');
  PROCESSES.forEach(proc => {
    const tr = document.createElement('tr');
    tr.className = 'dept-' + (PROCESS_DEPT[proc.no] || 'other');
    const tdNo = document.createElement('td'); tdNo.className = 'tl-no'; tdNo.textContent = proc.no;
    const tdName = document.createElement('td'); tdName.className = 'tl-name'; tdName.textContent = proc.name;
    const tdFlow = document.createElement('td'); tdFlow.className = 'tl-flow'; tdFlow.textContent = PROCESS_FLOW[proc.no] || '';
    tr.appendChild(tdNo); tr.appendChild(tdName); tr.appendChild(tdFlow);
    tr.appendChild(renderStatusCell(proj, proc));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  panel.appendChild(table);
  panel.scrollTop = scrollTop;
}
