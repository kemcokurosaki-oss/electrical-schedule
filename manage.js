// ─── 工番管理モーダル ─────────────────────────────────
// 電気の作業がある「工番＋機種」を選んで列として登録する（denki_columns）
let manageCandidates = null;  // 全体工程表にある工番ごとの { customer, machines }

document.getElementById('btn-manage').addEventListener('click', openManageModal);
document.getElementById('manage-close').addEventListener('click', closeManageModal);
document.getElementById('manage-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('manage-modal')) closeManageModal();
});
document.getElementById('manage-add-pn').addEventListener('input', updateMachineOptions);
document.getElementById('manage-add-btn').addEventListener('click', async () => {
  const pn = document.getElementById('manage-add-pn').value.trim();
  const mc = document.getElementById('manage-add-machine').value.trim();
  if (!pn) { alert('工番を入力してください'); return; }
  if (await addColumn(pn, mc)) {
    document.getElementById('manage-add-machine').value = ''; // 同じ工番の別の機種を続けて追加しやすいよう工番は残す
    updateMachineOptions();
  }
});

async function openManageModal() {
  if (!canEdit) return;
  document.getElementById('manage-modal').classList.add('active');
  if (!manageCandidates) {
    document.getElementById('manage-list').textContent = '読み込み中...';
    try {
      await loadManageCandidates();
    } catch (e) {
      document.getElementById('manage-list').textContent = '工番の一覧を読み込めませんでした: ' + (e.message || e);
      return;
    }
  }
  renderManageList();
}

function closeManageModal() {
  document.getElementById('manage-modal').classList.remove('active');
}

// 機種名として候補に出すもの（「DF,RV」のような複数機種のまとめ書きは除く）
function isCleanMachine(m) {
  return !/[,，、\/／＆&]/.test(m);
}

async function loadManageCandidates() {
  const [rows, completedRes] = await Promise.all([
    fetchAll(() => sb.from('tasks').select('project_number, machine, customer_name').order('id')),
    sb.from('completed_projects').select('project_number'),
  ]);
  if (completedRes.error) throw completedRes.error;
  const completed = new Set((completedRes.data || []).map(c => String(c.project_number)));

  manageCandidates = new Map();
  rows.forEach(t => {
    const pn = String(t.project_number || '').trim();
    if (!pn || completed.has(pn)) return;
    if (!manageCandidates.has(pn)) manageCandidates.set(pn, { customer: '', machines: new Set() });
    const c = manageCandidates.get(pn);
    if (!c.customer && t.customer_name) c.customer = t.customer_name;
    const m = (t.machine || '').trim();
    if (isCleanMachine(m)) c.machines.add(m);
  });
}

function machineLabel(m) {
  return m || '(機種なし)';
}

function columnsByProject() {
  const cols = {};
  currentProjects.forEach(p => { (cols[p.project_number] = cols[p.project_number] || []).push(p); });
  return cols;
}

// 表示中の工番だけを一覧にする（追加は上の入力欄から）
function renderManageList() {
  const list = document.getElementById('manage-list');
  const cols = columnsByProject();
  const pns = Object.keys(cols).sort();

  document.getElementById('manage-status').textContent =
    pns.length === 0 ? '表示中の列はありません' : `${pns.length}工番・${currentProjects.length}列を表示中`;

  list.innerHTML = '';
  pns.forEach(pn => list.appendChild(renderManageItem(pn, cols[pn])));
  updatePnOptions();
  updateMachineOptions();
}

function setDatalist(id, options) {
  const dl = document.getElementById(id);
  dl.innerHTML = '';
  options.forEach(({ value, label }) => {
    const o = document.createElement('option');
    o.value = value;
    if (label) o.label = label;
    dl.appendChild(o);
  });
}

// 工番のプルダウン: 全体工程表にあって、まだ表示していない工番
function updatePnOptions() {
  const shown = columnsByProject();
  setDatalist('manage-pn-list', [...manageCandidates.keys()]
    .filter(pn => !shown[pn])
    .sort()
    .map(pn => ({ value: pn, label: manageCandidates.get(pn).customer })));
}

// 機種のプルダウン: 入力中の工番で、全体工程表にある機種のうち、まだ列にしていないもの
function updateMachineOptions() {
  const pn = document.getElementById('manage-add-pn').value.trim();
  const cand = manageCandidates && manageCandidates.get(pn);
  const shown = new Set((columnsByProject()[pn] || []).map(c => c.machine));
  setDatalist('manage-machine-list', cand
    ? [...cand.machines].filter(m => m && !shown.has(m)).sort().map(m => ({ value: m }))
    : []);
}

function renderManageItem(pn, cols) {
  const cand = manageCandidates.get(pn) || { customer: '', machines: new Set() };
  const item = document.createElement('div');
  item.className = 'manage-item is-visible';

  const head = document.createElement('div');
  head.className = 'manage-item-head';
  const num = document.createElement('span'); num.className = 'manage-item-num'; num.textContent = pn;
  const detail = document.createElement('span'); detail.className = 'manage-item-detail'; detail.textContent = cand.customer || '';
  head.appendChild(num); head.appendChild(detail);
  item.appendChild(head);

  const row = document.createElement('div');
  row.className = 'manage-chips';
  cols.forEach((col, i) => row.appendChild(renderColumnChip(col, i, cols, cand)));
  item.appendChild(row);
  return item;
}

function renderColumnChip(col, i, cols, cand) {
  const chip = document.createElement('span');
  chip.className = 'manage-chip';

  const mkBtn = (text, title, onClick, disabled) => {
    const b = document.createElement('button');
    b.textContent = text; b.title = title; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  chip.appendChild(mkBtn('◀', '左へ移動', () => moveColumn(cols, i, -1), i === 0));
  const name = document.createElement('span');
  name.className = 'manage-chip-name';
  name.textContent = machineLabel(col.machine);
  chip.appendChild(name);

  // 全体工程表に同じ名前の機種が無い列は、連携に使う機種を選べる（例: FSBT1 → FS）
  if (!cand.machines.has(col.machine) && cand.machines.size) {
    const sel = document.createElement('select');
    sel.title = '全体工程表のどの機種と連携するか';
    sel.innerHTML = '<option value="">連携なし</option>';
    [...cand.machines].sort().forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = '連携: ' + machineLabel(m);
      sel.appendChild(o);
    });
    sel.value = col.link_machine !== col.machine ? col.link_machine : '';
    sel.addEventListener('change', () => setLinkMachine(col, sel.value));
    chip.appendChild(sel);
  }

  chip.appendChild(mkBtn('▶', '右へ移動', () => moveColumn(cols, i, 1), i === cols.length - 1));
  chip.appendChild(mkBtn('×', 'この列を外す（入力済みのデータは残ります）', () => removeColumn(col)));
  return chip;
}

// ─── 列の追加・削除・並べ替え ─────────────────────────
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

async function addColumn(pn, machine) {
  if (currentProjects.some(p => p.project_number === pn && p.machine === machine)) {
    alert(`${pn} ${machineLabel(machine)} はすでに表示中です`);
    return false;
  }
  const orders = currentProjects.filter(p => p.project_number === pn).map(p => p.sort_order);
  const sort_order = (orders.length ? Math.max(...orders) : 0) + 10;
  return manageWrite(sb.from('denki_columns').insert({ project_number: pn, machine, sort_order }));
}

async function removeColumn(col) {
  const hasData = Object.keys(statusMap).some(k => k.startsWith(`${col.project_number}__${col.machine}__`));
  const msg = `${col.project_number} ${machineLabel(col.machine)} を表示から外しますか？` +
    (hasData ? '\n（入力済みのデータは消えません。もう一度追加すると元に戻ります）' : '');
  if (!confirm(msg)) return;
  await manageWrite(sb.from('denki_columns').delete()
    .eq('project_number', col.project_number).eq('machine', col.machine));
}

async function moveColumn(cols, i, dir) {
  const order = [...cols];
  [order[i], order[i + dir]] = [order[i + dir], order[i]];
  const rows = order.map((c, idx) => ({
    project_number: c.project_number, machine: c.machine,
    link_machine: c.link_machine !== c.machine ? c.link_machine : null,
    sort_order: (idx + 1) * 10,
  }));
  await manageWrite(sb.from('denki_columns').upsert(rows, { onConflict: 'project_number,machine' }));
}

async function setLinkMachine(col, linkMachine) {
  await manageWrite(sb.from('denki_columns').update({ link_machine: linkMachine || null })
    .eq('project_number', col.project_number).eq('machine', col.machine));
}
