// ─── ガント横のタスクリスト（右側のカード） ─────────────────
// ガントで機械（またはその下の工程）の行を押すと、その機械のタスクリストを右側に出して見比べられるようにする。
// 工程の行から開いたときは、その工程に必要な項目（config.js の PROCESS_MAP）だけを表示する。同じ工程の行をもう一度押すと全項目に戻す
// 閉じているときは細いカード（#tl-tab）に、最後に開いた機械（無ければ選んでいる工番の最初の機械）の名前と完了数を出す
let panelCol = null;      // 表示中の列 { project_number, machine, rel: { label, nos, ganttId } | null }
let lastPanelCol = null;  // 最後に開いていた列（閉じたカードに出す・押すとこれを開く）
let panelFilter = 'all';  // 状態の絞り込み

// 状態の絞り込み。c は getStatusClass() の値（未入力は 'pending'）
const PANEL_FILTERS = [
  { key: 'all',  label: 'すべて',     title: 'すべての項目',       test: () => true },
  { key: 'todo', label: '未',         title: '未・未入力',         test: c => c === 'yet' || c === 'pending' },
  { key: 'wip',  label: '作業中',     title: '作業中',             test: c => c === 'wip' },
  { key: 'wait', label: '確認・手配', title: '確認依頼中・手配中', test: c => c === 'wait' },
  { key: 'done', label: '完了',       title: '完了',               test: c => c === 'done' },
  { key: 'na',   label: '対象外',     title: '対象外',             test: c => c === 'na' },
];

function openTaskPanel(pn, machine, rel) {
  // 同じ工程の行をもう一度押したら、絞り込みをやめて全項目を表示する
  if (rel && panelCol && panelCol.rel && panelCol.rel.ganttId === rel.ganttId
      && panelCol.project_number === pn && panelCol.machine === machine) rel = null;
  panelCol = { project_number: pn, machine, rel: rel || null };
  lastPanelCol = panelCol;
  document.getElementById('view-gantt').classList.add('panel-open');
  renderTaskPanel();
  if (ganttInitialized) { gantt.render(); setTimeout(resizeGantt, 0); }
}

function closeTaskPanel() {
  panelCol = null;
  document.getElementById('view-gantt').classList.remove('panel-open');
  renderTaskTab();
  if (ganttInitialized) { gantt.render(); setTimeout(resizeGantt, 0); }
}

// 閉じたカードで開く列: 選んでいる工番（無ければ最初の工番）で最後に開いた機械。無ければその工番の最初の機械
function taskTabCol() {
  const pn = selectedPn || currentProjects[0]?.project_number;
  if (lastPanelCol && lastPanelCol.project_number === pn) {
    const c = currentProjects.find(p => p.project_number === pn && p.machine === lastPanelCol.machine);
    if (c) return c;
  }
  return currentProjects.find(p => p.project_number === pn) || null;
}

function openTaskPanelDefault() {
  const col = taskTabCol();
  if (col) openTaskPanel(col.project_number, col.machine);
}
document.getElementById('tl-tab').addEventListener('click', openTaskPanelDefault);

// 閉じているときの細いカード
function renderTaskTab() {
  const tab = document.getElementById('tl-tab');
  tab.innerHTML = '<span class="tt-head">◀</span><span class="tt-title">タスクリスト</span>';
  const col = taskTabCol();
  if (!col) { tab.title = 'タスクリストを開く'; return; }
  const pr = progressOf(col);
  const name = col.machine || '(機種なし)';
  tab.title = `${col.project_number}　${name} のタスクリストを開く（${pr.total} 項目のうち ${pr.done} 項目が完了）`;
  const add = (cls, text) => { const s = document.createElement('span'); s.className = cls; if (text !== undefined) s.textContent = text; tab.appendChild(s); };
  add('tt-sep');
  add('tt-machine', name);
  add('tt-done', pr.done);
  add('tt-total', `/${pr.total}`);
}

function renderTaskPanel() {
  renderTaskTab();
  if (!panelCol) return;
  const cols = currentProjects.filter(p => p.project_number === panelCol.project_number);
  const proj = cols.find(p => p.machine === panelCol.machine);
  if (!proj) { closeTaskPanel(); return; } // 工番管理で列を外したとき

  const panel = document.getElementById('tl-panel');
  const scrollTop = panel.querySelector('.tp-scroll')?.scrollTop || 0;
  panel.innerHTML = '';

  // 見出し（議事録欄と同じ形）。▶ で閉じる
  const head = document.createElement('div');
  head.className = 'tp-head';
  head.innerHTML = '<button class="tp-close" title="閉じる">▶</button><span class="tp-title">タスクリスト</span><span class="tp-sub"></span>';
  head.querySelector('.tp-sub').textContent = `${proj.project_number}　${proj.customer_name || ''}`;
  head.querySelector('.tp-close').addEventListener('click', closeTaskPanel);
  panel.appendChild(head);

  // 同じ工番の機械を切り替える（各機械の完了数つき）
  const machines = document.createElement('div');
  machines.className = 'seg tp-machines';
  cols.forEach(c => {
    const pr = progressOf(c);
    const b = document.createElement('button');
    b.className = c === proj ? 'active' : '';
    b.title = `${c.machine || '(機種なし)'}：${pr.total} 項目のうち ${pr.done} 項目が完了`;
    b.innerHTML = '<span class="tp-machine-name"></span><span class="tp-machine-count"></span>';
    b.querySelector('.tp-machine-name').textContent = c.machine || '(機種なし)';
    b.querySelector('.tp-machine-count').textContent = `${pr.done}/${pr.total}`;
    b.addEventListener('click', () => openTaskPanel(c.project_number, c.machine));
    machines.appendChild(b);
  });
  panel.appendChild(machines);

  // 工程の行から開いたときは、その工程に必要な項目だけ
  const rel = panelCol.rel;
  const filtered = !!(rel && rel.nos.length);
  const base = PROCESSES.filter(proc => !filtered || rel.nos.includes(proc.no));
  const clsOf = proc => getStatusClass(statusOf(proj, proc));

  // 状態の絞り込み（件数つき）
  const fRow = document.createElement('div');
  fRow.className = 'tp-filter-row';
  const seg = document.createElement('div');
  seg.className = 'seg tp-filter';
  PANEL_FILTERS.forEach(f => {
    const b = document.createElement('button');
    b.className = f.key === panelFilter ? 'active' : '';
    b.title = f.title;
    b.innerHTML = '<span></span><span class="tp-filter-n"></span>';
    b.firstChild.textContent = f.label;
    b.lastChild.textContent = base.filter(p => f.test(clsOf(p))).length;
    b.addEventListener('click', () => { panelFilter = f.key; renderTaskPanel(); });
    seg.appendChild(b);
  });
  fRow.appendChild(seg);
  panel.appendChild(fRow);

  if (filtered) {
    const rp = relProgressByNos(proj, rel.nos);
    const ready = rp.total > 0 && rp.done === rp.total;
    const box = document.createElement('div');
    box.className = 'tp-rel' + (ready ? ' ready' : '');
    box.title = ready ? 'すべて完了しています。工程表の完了チェックを付けてよい状態です。' : '';
    box.innerHTML = '<b></b><span class="tp-rel-count"></span><button class="link tp-rel-all">全項目を表示</button>';
    box.querySelector('b').textContent = `「${rel.label}」に必要なタスク`;
    box.querySelector('.tp-rel-count').textContent = `${rp.done}/${rp.total} 完了`;
    box.querySelector('.tp-rel-all').addEventListener('click', () => openTaskPanel(proj.project_number, proj.machine));
    panel.appendChild(box);
  }

  const scroll = document.createElement('div');
  scroll.className = 'tp-scroll';
  const test = (PANEL_FILTERS.find(f => f.key === panelFilter) || PANEL_FILTERS[0]).test;
  const list = base.filter(proc => test(clsOf(proc)));
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'tp-empty';
    p.textContent = 'この状態の項目はありません';
    scroll.appendChild(p);
  } else {
    const table = document.createElement('table');
    table.className = 'tl-table tp-table';
    table.innerHTML = '<thead><tr><th class="tl-no">No.</th><th class="tl-name">項目</th><th class="tl-st">状態</th></tr></thead>';
    const tbody = document.createElement('tbody');
    list.forEach(proc => {
      const tr = document.createElement('tr');
      tr.className = 'dept-' + (PROCESS_DEPT[proc.no] || 'other');
      const tdNo = document.createElement('td'); tdNo.className = 'tl-no'; tdNo.textContent = proc.no;
      const tdName = document.createElement('td'); tdName.className = 'tl-name';
      tdName.innerHTML = '<div class="tl-name-text"></div>';
      tdName.firstChild.textContent = proc.name;
      // 工程表の工程と流れは、項目名の下に1行でまとめる
      const meta = [PROCESS_KOTEI[proc.no] ? `工程：${PROCESS_KOTEI[proc.no]}` : '', PROCESS_FLOW[proc.no] || ''].filter(Boolean).join('　・　');
      if (meta) {
        const k = document.createElement('div'); k.className = 'tl-name-kotei'; k.textContent = meta;
        tdName.appendChild(k);
      }
      tr.appendChild(tdNo); tr.appendChild(tdName);
      tr.appendChild(renderStatusCell(proj, proc));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
  }
  panel.appendChild(scroll);
  scroll.scrollTop = scrollTop;
}
