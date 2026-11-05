// ─── 工番管理モーダル ─────────────────────────────────
// 電気の作業がある「工番＋機械（＋ユニット）」を選んで列として登録する（denki_columns）
// 列のキー（machine）は 機械名＋ユニット名（例: FS と BT1 → FSBT1）。全体工程表とは link_machine と unit で照合する
let manageCandidates = null;   // 工番ごとの { customer, machines: Map<機械, Set<ユニット>> }
let mgPicking = null;          // 「＋ 機械を追加」を開いている工番
let mgNewSel = new Set();      // 「工番を追加」で選んでいる機械・ユニット（キー: 機械\tユニット）
let mgListOpen = false;        // 工番のプルダウンを開いているか

const mgEl = id => document.getElementById(id);
const mgPnInput = mgEl('manage-pn-input');

mgEl('btn-manage').addEventListener('click', openManageModal);
mgEl('manage-close').addEventListener('click', closeManageModal);
mgEl('manage-modal').addEventListener('click', e => {
  if (e.target === mgEl('manage-modal')) closeManageModal();
});
mgEl('manage-new-open').addEventListener('click', openNewForm);
mgEl('manage-new-cancel').addEventListener('click', closeNewForm);
mgEl('manage-new-add').addEventListener('click', addNewProject);
mgEl('manage-new-all').addEventListener('click', () => {
  const all = newCandidateList().map(mgKey);
  mgNewSel = mgNewSel.size === all.length ? new Set() : new Set(all);
  renderNewForm();
});
mgPnInput.addEventListener('input', () => { mgNewSel.clear(); showPnList(true); renderNewForm(); });
mgPnInput.addEventListener('focus', () => showPnList(true));
mgPnInput.addEventListener('blur', () => setTimeout(() => showPnList(false), 150));
mgPnInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const opts = pnOptions();
    if (mgListOpen && opts.length) pickPn(opts[0]);
    else addNewProject();
  }
  if (e.key === 'Escape') showPnList(false);
});
mgEl('manage-pn-toggle').addEventListener('mousedown', e => {
  e.preventDefault();
  mgPnInput.focus();
  showPnList(!mgListOpen);
});

async function openManageModal() {
  if (!canEdit) return;
  mgEl('manage-modal').classList.add('active');
  if (!manageCandidates) {
    mgEl('manage-list').innerHTML = '<div class="manage-msg">読み込み中...</div>';
    try {
      await loadManageCandidates();
    } catch (e) {
      mgEl('manage-list').innerHTML = '';
      const d = document.createElement('div');
      d.className = 'manage-msg';
      d.textContent = '工番の一覧を読み込めませんでした: ' + (e.message || e);
      mgEl('manage-list').appendChild(d);
      return;
    }
  }
  renderManageList();
}

function closeManageModal() {
  mgEl('manage-modal').classList.remove('active');
  closeNewForm();
  mgPicking = null;
}

// 機種名として候補に出すもの（「DF,RV」のような複数機種のまとめ書きは除く）
function isCleanMachine(m) {
  return !/[,，、\/／＆&]/.test(m);
}

// ユニットとして候補に出すもの（空欄と ALL は「機械全体」とみなす）
function isRealUnit(u) {
  return !!u && u.toUpperCase() !== 'ALL';
}

async function loadManageCandidates() {
  const [rows, completedRes] = await Promise.all([
    fetchAll(() => sb.from('tasks').select('project_number, machine, unit, customer_name').order('id')),
    sb.from('completed_projects').select('project_number'),
  ]);
  if (completedRes.error) throw completedRes.error;
  const completed = new Set((completedRes.data || []).map(c => String(c.project_number)));

  manageCandidates = new Map();
  rows.forEach(t => {
    const pn = String(t.project_number || '').trim();
    if (!pn || completed.has(pn)) return;
    if (!manageCandidates.has(pn)) manageCandidates.set(pn, { customer: '', machines: new Map() });
    const c = manageCandidates.get(pn);
    if (!c.customer && t.customer_name) c.customer = t.customer_name;
    const m = (t.machine || '').trim();
    if (!m || !isCleanMachine(m)) return;
    if (!c.machines.has(m)) c.machines.set(m, new Set());
    const u = (t.unit || '').trim();
    if (isRealUnit(u)) c.machines.get(m).add(u);
  });
}

// ─── 候補・表示の共通処理 ─────────────────────────────
const mgKey = x => `${x.m}\t${x.u}`;
const colMachineKey = (m, u) => m + u;   // 列のキー（例: FS + BT1 → FSBT1）

// 工番の候補を「機械全体 → ユニット」の順に並べる
function candidateList(pn) {
  const cand = manageCandidates && manageCandidates.get(pn);
  if (!cand) return [];
  const list = [];
  [...cand.machines.keys()].sort().forEach(m => {
    list.push({ m, u: '' });
    [...cand.machines.get(m)].sort().forEach(u => list.push({ m, u }));
  });
  return list;
}

// 機械ごとにまとめる（ユニットがある機械は「全体」とユニットを並べる）
function groupByMachine(list, pn) {
  const cand = manageCandidates && manageCandidates.get(pn);
  const groups = [];
  list.forEach(x => {
    let g = groups.find(y => y.m === x.m);
    if (!g) groups.push(g = { m: x.m, items: [], hasUnits: !!(cand && cand.machines.get(x.m) && cand.machines.get(x.m).size) });
    g.items.push(x);
  });
  return groups;
}

function pickLabel(x, hasUnits) {
  return x.u ? x.u : (hasUnits ? `${x.m}（全体）` : x.m);
}

function columnsByProject() {
  const cols = {};
  currentProjects.forEach(p => { (cols[p.project_number] = cols[p.project_number] || []).push(p); });
  return cols;
}

function isShown(pn, x) {
  return currentProjects.some(p => p.project_number === pn && p.machine === colMachineKey(x.m, x.u));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderGroups(box, pn, list, makeButton) {
  box.innerHTML = '';
  groupByMachine(list, pn).forEach(g => {
    const row = el('div', 'mg-group');
    row.appendChild(el('span', 'mg-group-name', g.m));
    g.items.forEach(x => row.appendChild(makeButton(x, pickLabel(x, g.hasUnits))));
    box.appendChild(row);
  });
}

// ─── 一覧 ─────────────────────────────────────────────
function renderManageList() {
  const list = mgEl('manage-list');
  const cols = columnsByProject();
  const pns = Object.keys(cols).sort();

  mgEl('manage-status').textContent =
    pns.length === 0 ? '表示中の列はありません' : `${pns.length}工番・${currentProjects.length}列を表示中`;

  list.innerHTML = '';
  if (pns.length === 0) list.appendChild(el('div', 'manage-msg', '右上の「＋ 工番を追加」から、表示する工番を追加してください。'));
  pns.forEach(pn => list.appendChild(renderManageRow(pn, cols[pn])));
  if (!mgEl('manage-new').hidden) renderNewForm();
}

function renderManageRow(pn, cols) {
  const cand = manageCandidates.get(pn) || { customer: '' };
  const row = el('div', 'mg-row');

  const head = el('div', 'mg-row-head');
  head.appendChild(el('span', 'mg-pn', pn));
  head.appendChild(el('span', 'mg-cust', cand.customer || cols[0].customer_name || ''));
  head.appendChild(el('span', 'mg-count', `${cols.length}列`));
  row.appendChild(head);

  const chips = el('div', 'mg-chips');
  cols.forEach((col, i) => chips.appendChild(renderColumnChip(col, i, cols)));
  const open = mgPicking === pn;
  const add = el('button', 'mg-add-mc' + (open ? ' on' : ''), open ? '閉じる' : '＋ 機械を追加');
  add.addEventListener('click', () => { mgPicking = open ? null : pn; renderManageList(); });
  chips.appendChild(add);
  row.appendChild(chips);

  if (open) {
    const picker = el('div', 'mg-picker');
    const rest = candidateList(pn).filter(x => !isShown(pn, x));
    if (rest.length === 0) {
      picker.appendChild(el('span', 'mg-picker-empty', '追加できる機械はありません'));
    } else {
      const box = el('div', 'mg-groups');
      renderGroups(box, pn, rest, (x, label) => {
        const b = el('button', 'mg-pick', '＋ ' + label);
        b.addEventListener('click', () => addColumn(pn, x.m, x.u));
        return b;
      });
      picker.appendChild(box);
    }
    row.appendChild(picker);
  }
  return row;
}

function renderColumnChip(col, i, cols) {
  const chip = el('span', 'mg-chip');
  const mkBtn = (cls, text, title, onClick, disabled) => {
    const b = el('button', cls, text);
    b.title = title; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  chip.appendChild(mkBtn('mg-mv', '‹', '左へ移動', () => moveColumn(cols, i, -1), i === 0));
  // ユニットの列は「機械名 ユニット名」、それ以外は列の名前をそのまま出す
  chip.appendChild(el('b', null, col.unit ? col.link_machine : machineLabel(col.machine)));
  if (col.unit) chip.appendChild(el('span', 'mg-unit', col.unit));
  chip.appendChild(mkBtn('mg-mv', '›', '右へ移動', () => moveColumn(cols, i, 1), i === cols.length - 1));
  chip.appendChild(mkBtn('mg-del', '✕', 'この列を外す（入力済みのデータは残ります）', () => removeColumn(col)));
  return chip;
}

function machineLabel(m) {
  return m || '(機種なし)';
}

// ─── 工番を追加 ───────────────────────────────────────
function openNewForm() {
  mgPicking = null;
  mgEl('manage-new').hidden = false;
  mgEl('manage-new-open').hidden = true;
  mgPnInput.value = '';
  mgNewSel.clear();
  renderManageList();
  mgPnInput.focus();
}

function closeNewForm() {
  mgEl('manage-new').hidden = true;
  mgEl('manage-new-open').hidden = false;
  mgPnInput.value = '';
  mgNewSel.clear();
  showPnList(false);
}

// プルダウンの候補: 全体工程表にあって、まだ表示していない工番（番号・顧客名で絞り込み）
function pnOptions() {
  if (!manageCandidates) return [];
  const shown = columnsByProject();
  const q = mgPnInput.value.trim().toLowerCase();
  return [...manageCandidates.keys()]
    .filter(pn => !shown[pn])
    .filter(pn => !q || pn.toLowerCase().includes(q) || manageCandidates.get(pn).customer.toLowerCase().includes(q))
    .sort();
}

function showPnList(open) {
  mgListOpen = open;
  mgPnInput.closest('.mg-combo').classList.toggle('open', open);
  const box = mgEl('manage-pn-list');
  box.hidden = !open;
  if (!open) { renderNewForm(); return; }
  box.innerHTML = '';
  const opts = pnOptions();
  const cur = mgPnInput.value.trim();
  opts.forEach(pn => {
    const c = manageCandidates.get(pn);
    const b = el('button', 'mg-opt' + (pn === cur ? ' active' : ''));
    b.type = 'button';
    b.appendChild(el('span', 'mg-opt-pn', pn));
    b.appendChild(el('span', 'mg-opt-cust', c.customer));
    b.appendChild(el('span', 'mg-opt-count', `${c.machines.size}機械`));
    b.addEventListener('mousedown', e => { e.preventDefault(); pickPn(pn); });
    box.appendChild(b);
  });
  if (opts.length === 0) box.appendChild(el('div', 'mg-opt-empty', '該当する工番はありません'));
}

function pickPn(pn) {
  mgPnInput.value = pn;
  mgNewSel.clear();
  showPnList(false);
}

function newCandidateList() {
  const pn = mgPnInput.value.trim();
  if (columnsByProject()[pn]) return [];
  return candidateList(pn);
}

function renderNewForm() {
  if (!manageCandidates) return;
  const pn = mgPnInput.value.trim();
  const shown = !!columnsByProject()[pn];
  const cand = shown ? null : manageCandidates.get(pn);
  const list = newCandidateList();

  mgEl('manage-new-cust').textContent = shown ? 'この工番はすでに表示中です' : (cand ? cand.customer : '');
  mgEl('manage-new-machines').hidden = list.length === 0;
  mgEl('manage-new-warn').hidden = !pn || !!cand || shown || mgListOpen;
  mgEl('manage-new-all').textContent = list.length && mgNewSel.size === list.length ? 'すべて解除' : 'すべて選択';

  renderGroups(mgEl('manage-new-groups'), pn, list, (x, label) => {
    const on = mgNewSel.has(mgKey(x));
    const b = el('button', 'mg-pick' + (on ? ' on' : ''), (on ? '✓ ' : '') + label);
    b.addEventListener('click', () => {
      if (on) mgNewSel.delete(mgKey(x)); else mgNewSel.add(mgKey(x));
      renderNewForm();
    });
    return b;
  });

  const add = mgEl('manage-new-add');
  add.disabled = !cand || mgNewSel.size === 0;
  add.textContent = mgNewSel.size ? `${mgNewSel.size}列を追加` : '追加';
}

async function addNewProject() {
  const pn = mgPnInput.value.trim();
  const picks = newCandidateList().filter(x => mgNewSel.has(mgKey(x)));
  if (!pn || picks.length === 0) return;
  const rows = picks.map((x, i) => columnRow(pn, x.m, x.u, (i + 1) * 10));
  if (await manageWrite(sb.from('denki_columns').insert(rows))) {
    closeNewForm();
    renderManageList();
  }
}

// ─── 列の追加・削除・並べ替え ─────────────────────────
function columnRow(pn, m, u, sort_order) {
  return { project_number: pn, machine: colMachineKey(m, u), link_machine: u ? m : null, unit: u || null, sort_order };
}

async function manageWrite(promise) {
  const { error } = await promise;
  if (error) {
    alert('保存できませんでした。ログインが切れている場合は、ページを再読み込みしてください。\n' + error.message);
    return false;
  }
  await refreshDisplay();
  if (manageCandidates) renderManageList();
  return true;
}

async function addColumn(pn, m, u) {
  if (isShown(pn, { m, u })) return;
  const orders = currentProjects.filter(p => p.project_number === pn).map(p => p.sort_order);
  const sort_order = (orders.length ? Math.max(...orders) : 0) + 10;
  await manageWrite(sb.from('denki_columns').insert(columnRow(pn, m, u, sort_order)));
}

async function removeColumn(col) {
  const hasData = Object.keys(statusMap).some(k => k.startsWith(`${col.project_number}__${col.machine}__`));
  const name = col.unit ? `${col.link_machine} ${col.unit}` : machineLabel(col.machine);
  const msg = `${col.project_number} ${name} を表示から外しますか？` +
    (hasData ? '\n（入力済みのデータは消えません。もう一度追加すると元に戻ります）' : '');
  if (!confirm(msg)) return;
  await manageWrite(sb.from('denki_columns').delete()
    .eq('project_number', col.project_number).eq('machine', col.machine));
}

async function moveColumn(cols, i, dir) {
  const order = [...cols];
  [order[i], order[i + dir]] = [order[i + dir], order[i]];
  const rows = order.map((c, idx) => {
    const row = {
      project_number: c.project_number, machine: c.machine,
      link_machine: c.link_machine !== c.machine ? c.link_machine : null,
      sort_order: (idx + 1) * 10,
    };
    if (c.unit) row.unit = c.unit;
    return row;
  });
  await manageWrite(sb.from('denki_columns').upsert(rows, { onConflict: 'project_number,machine' }));
}
