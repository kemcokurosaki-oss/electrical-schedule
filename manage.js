// ─── 工番・機械の登録（管理画面のタブの1つ。枠とタブは admin.js） ───────
// 電気の作業がある「工番＋機械（＋ユニット）」を選んで列として登録する（denki_columns）
// 列のキー（machine）は 機械名＋ユニット名（例: FS と BT1 → FSBT1）。全体工程表とは link_machine と unit で照合する
let manageCandidates = null;   // 工番ごとの { customer, machines: Map<機械, Set<ユニット>> }
let mgView = null;             // 描画先（admin.js の .am-view）
let mgSel = null;              // 左の一覧で選んでいる工番
let mgNewOpen = false;         // 「工番を追加」を開いているか
let mgNewPn = null;            // 「工番を追加」で選んだ工番
let mgNewQ = '';               // 工番の絞り込み
let mgUnitsOpen = false;       // 「ユニットで追加する」を開いているか（ふだんは機械名だけ出す）
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
  mgView = null; mgUnitsOpen = false; mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set();
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

// 工番の候補（機械名だけ）
function candidateList(pn) {
  const cand = manageCandidates && manageCandidates.get(pn);
  if (!cand) return [];
  return [...cand.machines.keys()].sort().map(m => ({ m, u: '' }));
}

// ユニットの候補（「ユニットで追加する」を開いたときだけ出す）
function unitList(pn) {
  const cand = manageCandidates && manageCandidates.get(pn);
  if (!cand) return [];
  const list = [];
  [...cand.machines.keys()].sort().forEach(m => [...cand.machines.get(m)].sort().forEach(u => list.push({ m, u })));
  return list;
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

// 機械のボタンを並べ、その下に「ユニットで追加する」（押すと機械ごとのユニットが開く）
function renderPicks(box, list, units, makeButton) {
  if (list.length) {
    const wrap = el('div', 'am-group');
    list.forEach(x => wrap.appendChild(makeButton(x, x.m)));
    box.appendChild(wrap);
  }
  if (!units.length) return;
  box.appendChild(amBtn('am-link am-unitlink', mgUnitsOpen ? 'ユニットで追加する ▾' : 'ユニットで追加する ▸',
    () => { mgUnitsOpen = !mgUnitsOpen; renderManage(); }));
  if (!mgUnitsOpen) return;
  const ub = el('div', 'am-units');
  [...new Set(units.map(x => x.m))].forEach(m => {
    const row = el('div', 'am-group');
    row.appendChild(el('span', 'am-unitm', m));
    units.filter(x => x.m === m).forEach(x => row.appendChild(makeButton(x, x.u)));
    ub.appendChild(row);
  });
  box.appendChild(ub);
}

// ─── 画面 ─────────────────────────────────────────────
// 左に工番の一覧、右に選んだ工番の機械（上から順＝進捗確認表の左から順）。ステップの設定と同じ並び
function renderManage() {
  const view = mgView;
  if (!view || !view.isConnected) return;
  const oldItems = view.querySelector('.am-items');
  const oldBody = view.querySelector('.am-mgbody');
  const itemsTop = oldItems ? oldItems.scrollTop : 0;
  const bodyTop = oldBody ? oldBody.scrollTop : 0;
  view.innerHTML = '';

  const cols = columnsByProject();
  const pns = Object.keys(cols).sort();
  if (!mgNewOpen && !cols[mgSel]) mgSel = pns[0] || null;

  const bar = el('div', 'am-bar');
  bar.appendChild(el('b', '', pns.length ? `${pns.length}工番・${currentProjects.length}列を表示中` : '表示中の列はありません'));
  bar.appendChild(el('span', 'am-hint', '変更はすぐに保存されます。列を外しても入力済みのデータは残ります。'));
  if (!mgNewOpen) bar.appendChild(amBtn('am-btn dark', '＋ 工番を追加', () => { mgNewOpen = true; renderManage(); }));
  view.appendChild(bar);

  const split = el('div', 'am-split');
  const left = el('div', 'am-card');
  const lhead = el('div', 'am-cardhead');
  lhead.appendChild(el('b', '', '工番'));
  lhead.appendChild(el('span', '', `${pns.length}工番`));
  left.appendChild(lhead);
  const items = el('div', 'am-items');
  pns.forEach(pn => {
    const cand = manageCandidates.get(pn);
    const b = amBtn('am-item pn' + (!mgNewOpen && pn === mgSel ? ' on' : ''), null, () => {
      if (mgNewOpen) { mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set(); }
      mgSel = pn; renderManage();
    });
    b.appendChild(el('b', '', pn));
    b.appendChild(el('span', 'nm', (cand && cand.customer) || cols[pn][0].customer_name || ''));
    const meta = el('span', 'meta');
    meta.appendChild(el('span', 'am-badge', String(cols[pn].length)));
    b.appendChild(meta);
    items.appendChild(b);
  });
  if (!pns.length) items.appendChild(el('div', 'am-muted', '右上の「＋ 工番を追加」から、表示する工番を追加してください。'));
  left.appendChild(items);
  split.appendChild(left);

  if (mgNewOpen) split.appendChild(renderNewCard());
  else if (mgSel) split.appendChild(renderJobEditor(mgSel, cols[mgSel]));
  else split.appendChild(el('div', 'am-card am-muted', '工番がありません。'));
  view.appendChild(split);

  items.scrollTop = itemsTop;
  const body = view.querySelector('.am-mgbody');
  if (body) body.scrollTop = bodyTop;
}

function renderJobEditor(pn, cols) {
  const cand = manageCandidates.get(pn) || { customer: '' };
  const card = el('div', 'am-card');

  const head = el('div', 'am-edhead');
  head.appendChild(el('b', 'no', pn));
  head.appendChild(el('b', 'nm', cand.customer || cols[0].customer_name || ''));
  head.appendChild(el('span', 'am-edcnt', `${cols.length}台`));
  card.appendChild(head);

  const body = el('div', 'am-edbody am-mgbody');
  const col = el('div', 'am-edcol');
  col.appendChild(el('span', 'am-label', '機械（上から順に、進捗確認表の左から並びます）'));
  cols.forEach((c, i) => col.appendChild(renderColumnRow(c, i, cols)));
  if (!cols.length) col.appendChild(el('div', 'am-nosteps', '表示する機械がありません'));
  body.appendChild(col);

  const pick = el('div', 'am-preview');
  pick.appendChild(el('span', 'am-label', '追加できる機械（全体工程表から）'));
  const rest = candidateList(pn).filter(x => !isShown(pn, x));
  const restUnits = unitList(pn).filter(x => !isShown(pn, x));
  if (!rest.length) pick.appendChild(el('span', 'am-hint', '追加できる機械はありません'));
  renderPicks(pick, rest, restUnits, (x, label) => amBtn('am-pick add', '＋ ' + label, () => addColumn(pn, x.m, x.u)));
  body.appendChild(pick);

  card.appendChild(body);
  return card;
}

function renderColumnRow(col, i, cols) {
  const row = el('div', 'am-step');
  row.appendChild(el('span', 'n', String(i + 1)));
  // ユニットの列は「機械名 ユニット名」、それ以外は列の名前をそのまま出す
  const nm = el('div', 'am-mname');
  nm.appendChild(el('b', '', col.unit ? col.link_machine : machineLabel(col.machine)));
  if (col.unit) nm.appendChild(el('span', '', col.unit));
  row.appendChild(nm);
  const btn = (cls, label, title, fn, disabled) => { const b = amBtn('am-sbtn' + cls, label, fn); b.title = title; b.disabled = !!disabled; return b; };
  row.appendChild(btn('', '▲', '上へ移動（進捗確認表では左へ）', () => moveColumn(cols, i, -1), i === 0));
  row.appendChild(btn('', '▼', '下へ移動（進捗確認表では右へ）', () => moveColumn(cols, i, 1), i === cols.length - 1));
  row.appendChild(btn(' del', '✕', 'この列を外す（入力済みのデータは残ります）', () => removeColumn(col)));
  return row;
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
      rh.appendChild(el('b', '', '表示する機械'));
      rh.appendChild(el('span', '', '全体工程表から拾っています。押して選択'));
      const allOn = list.every(x => mgNewSel.has(mgKey(x)));
      rh.appendChild(amBtn('am-btn sm', allOn ? 'すべて解除' : 'すべて選択', () => {
        list.forEach(x => { if (allOn) mgNewSel.delete(mgKey(x)); else mgNewSel.add(mgKey(x)); });
        renderManage();
      }));
      body.appendChild(rh);
      const groups = el('div', 'am-edcol');
      renderPicks(groups, list, unitList(mgNewPn), (x, label) => {
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
  const picks = [...candidateList(pn), ...unitList(pn)].filter(x => mgNewSel.has(mgKey(x)));
  if (!pn || picks.length === 0) return;
  mgNewOpen = false; mgNewPn = null; mgNewQ = ''; mgNewSel = new Set(); mgSel = pn;
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
