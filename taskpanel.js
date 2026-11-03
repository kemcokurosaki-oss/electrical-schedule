// ─── ガント横のタスクリスト（右側のパネル） ─────────────────
// ガントで機械（またはその下の工程）の行を押すと、その機械のタスクリストを右側に出して見比べられるようにする。
// 工程の行から開いたときは、その工程に必要な項目（config.js の PROCESS_MAP）を黄色で強調する
let panelCol = null; // 表示中の列 { project_number, machine, rel: { label, nos, ganttId } | null }

function openTaskPanel(pn, machine, rel) {
  const wasOpen = !!panelCol;
  panelCol = { project_number: pn, machine, rel: rel || null };
  document.getElementById('view-gantt').classList.add('panel-open');
  // 会議中にタスクリストを開いたら、ガントの高さを確保するため議事録欄を畳む
  if (!wasOpen && activeMeeting() && dockOpen) setDockOpen(false);
  renderTaskPanel();
  if (ganttInitialized) { gantt.render(); setTimeout(resizeGantt, 0); }
}

function closeTaskPanel() {
  panelCol = null;
  document.getElementById('view-gantt').classList.remove('panel-open');
  if (ganttInitialized) { gantt.render(); setTimeout(resizeGantt, 0); }
}

// 右端の「タスクリスト」タブ: 選んでいる工番（無ければ最初の工番）の最初の機械を開く
function openTaskPanelDefault() {
  const pn = selectedPn || currentProjects[0]?.project_number;
  const col = currentProjects.find(p => p.project_number === pn);
  if (col) openTaskPanel(col.project_number, col.machine);
}
document.getElementById('tl-tab').addEventListener('click', openTaskPanelDefault);

function renderTaskPanel() {
  if (!panelCol) return;
  const cols = currentProjects.filter(p => p.project_number === panelCol.project_number);
  const proj = cols.find(p => p.machine === panelCol.machine);
  if (!proj) { closeTaskPanel(); return; } // 工番管理で列を外したとき

  const panel = document.getElementById('tl-panel');
  const scrollTop = panel.querySelector('.tp-scroll')?.scrollTop || 0;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.innerHTML = '<span class="tp-title"></span><span class="tp-sub">タスクリスト</span><button class="tp-close" title="閉じる">✕</button>';
  head.querySelector('.tp-title').textContent = `${proj.project_number}　${proj.customer_name || ''}`;
  head.querySelector('.tp-close').addEventListener('click', closeTaskPanel);
  panel.appendChild(head);

  // 同じ工番の機械を切り替えるボタン
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

  // 工程の行から開いたとき: その工程に必要な項目の完了数
  const rel = panelCol.rel;
  if (rel && rel.nos.length) {
    const rp = relProgressByNos(proj, rel.nos);
    const ready = rp.total > 0 && rp.done === rp.total;
    const box = document.createElement('div');
    box.className = 'tp-rel' + (ready ? ' ready' : '');
    box.innerHTML = '<b></b><span></span>';
    box.querySelector('b').textContent = `工程「${rel.label}」に必要なタスク　${rp.done}/${rp.total} 完了`;
    box.querySelector('span').textContent = ready
      ? 'すべて完了しています。工程表の完了チェックを付けてよい状態です。'
      : '黄色の行がこの工程に必要なタスクです。すべて完了すると「完了可」になります。';
    panel.appendChild(box);
  }

  const scroll = document.createElement('div');
  scroll.className = 'tp-scroll';
  const table = document.createElement('table');
  table.className = 'tl-table tp-table';
  table.innerHTML = '<thead><tr><th class="tl-no">No.</th><th class="tl-name">項目</th><th class="tl-flow">流れ</th><th class="tl-machine"></th></tr></thead>';
  table.querySelector('th.tl-machine').textContent = proj.machine || '(機種なし)';
  const tbody = document.createElement('tbody');
  PROCESSES.forEach(proc => {
    const tr = document.createElement('tr');
    tr.className = 'dept-' + (PROCESS_DEPT[proc.no] || 'other') + (rel && rel.nos.includes(proc.no) ? ' tl-rel' : '');
    const tdNo = document.createElement('td'); tdNo.className = 'tl-no'; tdNo.textContent = proc.no;
    const tdName = document.createElement('td'); tdName.className = 'tl-name';
    tdName.innerHTML = '<div class="tl-name-text"></div>';
    tdName.firstChild.textContent = proc.name;
    tdName.title = proc.name;
    if (PROCESS_KOTEI[proc.no]) {
      const k = document.createElement('div'); k.className = 'tl-name-kotei'; k.textContent = `工程：${PROCESS_KOTEI[proc.no]}`;
      tdName.appendChild(k);
    }
    const tdFlow = document.createElement('td'); tdFlow.className = 'tl-flow'; tdFlow.textContent = PROCESS_FLOW[proc.no] || '';
    tr.appendChild(tdNo); tr.appendChild(tdName); tr.appendChild(tdFlow);
    tr.appendChild(renderStatusCell(proj, proc));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  panel.appendChild(scroll);
  scroll.scrollTop = scrollTop;
}
