// ─── 工番・機械の登録（管理画面のタブの1つ。枠とタブは admin.js） ───────
// 電気の作業がある「工番＋機械（＋ユニット）」を選んで列として登録する（denki_columns）
// 列のキー（machine）は 機械名＋ユニット名（例: FS と BT1 → FSBT1）。全体工程表とは link_machine と unit で照合する
let manageCandidates = null;   // 工番ごとの { customer, machines: Map<機械, Set<ユニット>> }
let mgView = null;             // 描画先（admin.js の .am-view）
let mgPicking = null;          // 「＋ 機械を追加」を開いている工番
let mgNewOpen = false;         // 「工番を追加」を開いているか
let mgNewPn = null;            // 「工番を追加」で選んだ工番
let mgNewQ = '';               // 工番の絞り込み
let mgNewSel = new Set();      // 「工番を追加」で選んでいる機械・ユニット（キー: 機械\tユニット）

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function amBtn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function mgReset() {
  mgView = null; mgPicking = null; mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set();
}

async function renderManageView(view) {
  mgReset();
  mgView = view;
  view.appendChild(el('div', 'am-muted', '読み込み中…'));
  if (!manageCandidates) {
    try {
      await loadManageCandidates();
    } catch (e) {
      if (mgView !== view) return;
      view.innerHTML = '';
      view.appendChild(el('div', 'am-muted', '工番の一覧を読み込めませんでした: ' + (e.message || e)));
      return;
    }
  }
  if (mgView !== view) return;
  renderManage();
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

function machineLabel(m) {
  return m || '(機種なし)';
}

function renderGroups(box, pn, list, makeButton) {
  groupByMachine(list, pn).forEach(g => {
    const row = el('div', 'am-group');
    row.appendChild(el('span', '', g.m));
    g.items.forEach(x => row.appendChild(makeButton(x, pickLabel(x, g.hasUnits))));
    box.appendChild(row);
  });
}

// ─── 画面 ─────────────────────────────────────────────
function renderManage() {
  const view = mgView;
  if (!view || !view.isConnected) return;
  const old = view.querySelector('.am-scroll');
  const top = old ? old.scrollTop : 0;
  view.innerHTML = '';

  const cols = columnsByProject();
  const pns = Object.keys(cols).sort();

  const bar = el('div', 'am-bar');
  bar.appendChild(el('b', '', pns.length ? `${pns.length}工番・${currentProjects.length}列を表示中` : '表示中の列はありません'));
  bar.appendChild(el('span', 'am-hint', '変更はすぐに保存されます。列を外しても入力済みのデータは残ります。'));
  if (!mgNewOpen) bar.appendChild(amBtn('am-btn dark', '＋ 工番を追加', () => { mgNewOpen = true; mgPicking = null; renderManage(); }));
  view.appendChild(bar);

  const scroll = el('div', 'am-scroll');
  if (mgNewOpen) scroll.appendChild(renderNewCard());
  if (!pns.length) scroll.appendChild(el('div', 'am-muted', '右上の「＋ 工番を追加」から、表示する工番を追加してください。'));
  const grid = el('div', 'am-jobs');
  pns.forEach(pn => grid.appendChild(renderJobCard(pn, cols[pn])));
  scroll.appendChild(grid);
  view.appendChild(scroll);
  scroll.scrollTop = top;
}

function renderJobCard(pn, cols) {
  const cand = manageCandidates.get(pn) || { customer: '' };
  const open = mgPicking === pn;
  const card = el('div', 'am-card');

  const band = el('div', 'am-band');
  band.appendChild(el('b', '', pn));
  band.appendChild(el('span', 'cust', cand.customer || cols[0].customer_name || ''));
  band.appendChild(el('span', 'cnt', `${cols.length}台`));
  band.appendChild(amBtn('am-btn sm' + (open ? ' on' : ''), open ? '閉じる' : '＋ 機械を追加', () => { mgPicking = open ? null : pn; renderManage(); }));
  card.appendChild(band);

  const tiles = el('div', 'am-tiles');
  cols.forEach((col, i) => tiles.appendChild(renderColumnTile(col, i, cols)));
  if (!cols.length) tiles.appendChild(el('span', 'am-empty-line', '表示する機械がありません'));
  card.appendChild(tiles);

  if (open) {
    const picker = el('div', 'am-picker');
    picker.appendChild(el('span', 'am-plabel', '追加できる機械・ユニット（全体工程表から）'));
    const rest = candidateList(pn).filter(x => !isShown(pn, x));
    if (!rest.length) picker.appendChild(el('span', 'am-hint', '追加できる機械はありません'));
    renderGroups(picker, pn, rest, (x, label) => amBtn('am-pick add', '＋ ' + label, () => addColumn(pn, x.m, x.u)));
    card.appendChild(picker);
  }
  return card;
}

function renderColumnTile(col, i, cols) {
  const t = el('div', 'am-tile');
  const mv = (text, title, dir, disabled) => {
    const b = amBtn('mv', text, () => moveColumn(cols, i, dir));
    b.title = title; b.disabled = disabled;
    return b;
  };
  t.appendChild(mv('‹', '左へ移動', -1, i === 0));
  // ユニットの列は「機械名 ユニット名」、それ以外は列の名前をそのまま出す
  const nm = el('span', 'nm');
  nm.appendChild(el('b', '', col.unit ? col.link_machine : machineLabel(col.machine)));
  if (col.unit) nm.appendChild(el('span', '', col.unit));
  t.appendChild(nm);
  t.appendChild(mv('›', '右へ移動', 1, i === cols.length - 1));
  const del = amBtn('del', '✕', () => removeColumn(col));
  del.title = 'この列を外す（入力済みのデータは残ります）';
  t.appendChild(del);
  return t;
}

// ─── 工番を追加 ───────────────────────────────────────
function closeNewForm() {
  mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set();
  renderManage();
}

// 候補: 全体工程表にあって、まだ表示していない工番（番号・客先名で絞り込み）
function pnOptions() {
  if (!manageCandidates) return [];
  const shown = columnsByProject();
  const q = mgNewQ.trim().toLowerCase();
  return [...manageCandidates.keys()]
    .filter(pn => !shown[pn])
    .filter(pn => !q || pn.toLowerCase().includes(q) || manageCandidates.get(pn).customer.toLowerCase().includes(q))
    .sort();
}

function pickPn(pn) {
  mgNewPn = pn;
  mgNewSel = new Set();
  renderManage();
}

function renderPnOptions(box) {
  box.innerHTML = '';
  const opts = pnOptions();
  opts.forEach(pn => {
    const c = manageCandidates.get(pn);
    const b = amBtn('am-opt', null, () => pickPn(pn));
    b.appendChild(el('b', '', pn));
    b.appendChild(el('span', 'cust', c.customer));
    b.appendChild(el('span', 'cnt', `${c.machines.size}機械`));
    box.appendChild(b);
  });
  if (!opts.length) box.appendChild(el('span', 'am-hint', '該当する工番はありません。全体工程表に無い工番は追加できません。'));
}

function renderNewCard() {
  const card = el('div', 'am-card am-new');
  const head = el('div', 'am-new-head');
  head.appendChild(el('b', '', '工番を追加'));
  head.appendChild(el('span', '', '全体工程表にある工番から選びます'));
  card.appendChild(head);

  const body = el('div', 'am-new-body');
  const list = mgNewPn ? candidateList(mgNewPn) : [];
  if (!mgNewPn) {
    const inp = el('input', 'am-input');
    inp.type = 'text'; inp.placeholder = '工番・客先名で絞り込み'; inp.autocomplete = 'off'; inp.value = mgNewQ;
    const box = el('div', 'am-opts');
    inp.addEventListener('input', () => { mgNewQ = inp.value; renderPnOptions(box); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { const o = pnOptions(); if (o.length) pickPn(o[0]); } });
    body.appendChild(inp);
    body.appendChild(box);
    renderPnOptions(box);
    setTimeout(() => inp.focus());
  } else {
    const cand = manageCandidates.get(mgNewPn);
    const chosen = el('div', 'am-chosen');
    chosen.appendChild(el('b', '', mgNewPn));
    chosen.appendChild(el('span', '', cand ? cand.customer : ''));
    chosen.appendChild(amBtn('am-btn sm', '工番を変える', () => { mgNewPn = null; mgNewSel = new Set(); renderManage(); }));
    body.appendChild(chosen);
    if (list.length) {
      const rh = el('div', 'am-rowhead');
      rh.appendChild(el('b', '', '表示する機械・ユニット'));
      rh.appendChild(el('span', '', '全体工程表から拾っています。押して選択'));
      rh.appendChild(amBtn('am-btn sm', mgNewSel.size === list.length ? 'すべて解除' : 'すべて選択', () => {
        mgNewSel = mgNewSel.size === list.length ? new Set() : new Set(list.map(mgKey));
        renderManage();
      }));
      body.appendChild(rh);
      const groups = el('div', 'am-edcol');
      renderGroups(groups, mgNewPn, list, (x, label) => {
        const on = mgNewSel.has(mgKey(x));
        return amBtn('am-pick' + (on ? ' on' : ''), (on ? '✓ ' : '') + label, () => {
          if (on) mgNewSel.delete(mgKey(x)); else mgNewSel.add(mgKey(x));
          renderManage();
        });
      });
      body.appendChild(groups);
    } else {
      body.appendChild(el('div', 'am-warn', '全体工程表にこの工番の機械がありません。全体工程表を確認してください。'));
    }
  }

  const foot = el('div', 'am-new-foot');
  foot.appendChild(amBtn('am-btn', 'やめる', closeNewForm));
  const add = amBtn('am-btn dark', mgNewSel.size ? `${mgNewSel.size}列を追加` : '追加', addNewProject);
  add.disabled = !mgNewPn || !mgNewSel.size;
  foot.appendChild(add);
  body.appendChild(foot);
  card.appendChild(body);
  return card;
}

async function addNewProject() {
  const pn = mgNewPn;
  const picks = candidateList(pn).filter(x => mgNewSel.has(mgKey(x)));
  if (!pn || picks.length === 0) return;
  mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set();
  const rows = picks.map((x, i) => columnRow(pn, x.m, x.u, (i + 1) * 10));
  await manageWrite(sb.from('denki_columns').insert(rows));
}

// ─── 列の追加・削除・並べ替え ─────────────────────────
function columnRow(pn, m, u, sort_order) {
  return { project_number: pn, machine: colMachineKey(m, u), link_machine: u ? m : null, unit: u || null, sort_order };
}

async function manageWrite(promise) {
  const { error } = await promise;
  if (error) {
    alert('保存できませんでした。ログインが切れている場合は、ページを再読み込みしてください。\n' + error.message);
    renderManage();
    return false;
  }
  await refreshDisplay();
  if (manageCandidates) renderManage();
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
