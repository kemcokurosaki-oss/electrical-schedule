// ─── 管理画面（v2.1） ─────────────────────────────────
// 「管理」ボタンのメニューから開く。工番・機械の登録（manage.js）／完了工番／ステップの設定 を上のタブで切り替える
const adminMenu = document.getElementById('admin-menu');
// 左メニューは overflow: hidden なので、メニューは画面基準（fixed）でボタンの右に出す
document.getElementById('btn-admin').addEventListener('click', e => {
  e.stopPropagation();
  if (adminMenu.hidden) {
    const r = e.currentTarget.getBoundingClientRect();
    const nav = document.getElementById('side-nav').getBoundingClientRect();
    adminMenu.style.left = (nav.right + 12) + 'px';
    adminMenu.style.bottom = (window.innerHeight - r.bottom) + 'px';
  }
  adminMenu.hidden = !adminMenu.hidden;
});
adminMenu.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') adminMenu.hidden = true; });
document.addEventListener('click', e => { if (!adminMenu.hidden && !adminMenu.contains(e.target)) adminMenu.hidden = true; });
document.getElementById('btn-manage').addEventListener('click', () => openAdmin('manage'));
document.getElementById('btn-done-pns').addEventListener('click', () => openAdmin('done'));
document.getElementById('btn-steps').addEventListener('click', () => openAdmin('steps'));

const adminModal = document.getElementById('admin-modal');
const adminBox = document.getElementById('admin-modal-box');
const ADMIN_TABS = [['manage', '工番・機械の登録'], ['done', '完了工番'], ['steps', 'ステップの設定']];
let adminTab = null;
let adminDirty = false;   // ステップの設定で保存していない変更があるか
adminModal.addEventListener('click', e => { if (e.target.dataset.close) closeAdmin(); });

function confirmLeave() {
  return !adminDirty || confirm('保存していない変更があります。破棄してもいいですか？');
}

function openAdmin(tab) {
  if (!canEdit) return;
  if (!adminModal.hidden && tab === adminTab) return;
  if (!adminModal.hidden && !confirmLeave()) return;
  mgReset();
  adminTab = tab; adminDirty = false;
  adminModal.hidden = false;
  adminBox.className = 'v2-modal-box';
  adminBox.innerHTML = '';
  adminBox.appendChild(adminHead());
  const view = el('div', 'am-view');
  adminBox.appendChild(view);
  if (tab === 'manage') renderManageView(view);
  if (tab === 'done') openDonePns(view);
  if (tab === 'steps') openSteps(view);
}

function closeAdmin() {
  if (!confirmLeave()) return;
  mgReset();
  adminModal.hidden = true; adminBox.innerHTML = ''; adminTab = null; adminDirty = false;
}

function adminHead() {
  const h = el('div', 'am-head');
  h.appendChild(el('span', 'am-title', '管理'));
  const tabs = el('div', 'am-tabs');
  ADMIN_TABS.forEach(([key, label]) => tabs.appendChild(amBtn('am-tab' + (key === adminTab ? ' on' : ''), label, () => openAdmin(key))));
  h.appendChild(tabs);
  const x = amBtn('am-close', '✕', closeAdmin);
  x.title = '閉じる';
  h.appendChild(x);
  return h;
}

// ─── 完了工番 ───────────────────────────────────────
// 工番単位で完了にする。完了にした工番は表示しないだけで、データは残る
let doneAsk = null;     // 「完了にしますか？」を出している工番
let doneAt = {};        // 工番 → 完了にした日時

async function openDonePns(view) {
  doneAsk = null;
  const bar = el('div', 'am-bar');
  bar.appendChild(el('b', '', '工番ごとに完了にします'));
  bar.appendChild(el('span', 'am-hint', '完了にした工番は進捗確認表と左メニューに出なくなります。データは残り、いつでも戻せます。'));
  view.appendChild(bar);
  const two = el('div', 'am-two');
  two.appendChild(el('div', 'am-muted', '読み込み中…'));
  view.appendChild(two);

  // 客先名が無い工番（完了済みなど）は全体工程表から拾う
  const pns = [...new Set(allColumns.map(c => c.project_number))];
  const missing = pns.filter(pn => !customerOf[pn]);
  await Promise.all([
    missing.length ? fetchAll(() => sb.from('tasks').select('project_number, customer_name').in('project_number', missing).not('customer_name', 'is', null))
      .then(rows => rows.forEach(r => { if (!customerOf[r.project_number]) customerOf[r.project_number] = r.customer_name; }))
      .catch(() => {}) : null,
    sb.from('denki_completed_projects').select('project_number, completed_at')
      .then(r => { doneAt = {}; (r.data || []).forEach(x => { doneAt[String(x.project_number)] = x.completed_at; }); }),
  ]);
  if (!two.isConnected) return;
  renderDonePns(two);
}

function fmtDoneDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} 完了・`;
}

function renderDonePns(two) {
  two.innerHTML = '';
  const pns = [...new Set(allColumns.map(c => c.project_number))].sort();
  const count = pn => allColumns.filter(c => c.project_number === pn).length;
  const column = (title, items, done) => {
    const card = el('div', 'am-card');
    const h = el('div', 'am-colhead' + (done ? ' light' : ''));
    h.appendChild(el('b', '', title));
    h.appendChild(el('span', '', `${items.length}工番`));
    card.appendChild(h);
    const list = el('div', 'am-list');
    if (!items.length) list.appendChild(el('div', 'am-muted', done ? '完了した工番はありません' : '進行中の工番はありません'));
    items.forEach(pn => {
      const asking = doneAsk === pn;
      const row = el('div', 'am-pn' + (done ? ' done' : '') + (asking ? ' asking' : ''));
      row.appendChild(el('b', '', pn));
      const info = el('div', 'am-pn-info');
      info.appendChild(el('span', 'cust', customerOf[pn] || ''));
      info.appendChild(el('span', 'sub', (done && doneAt[pn] ? fmtDoneDate(doneAt[pn]) : '') + `${count(pn)}台`));
      row.appendChild(info);
      if (asking) {
        const a = el('div', 'am-ask');
        a.appendChild(el('span', '', done ? '進行中に戻しますか？' : '完了にしますか？'));
        a.appendChild(amBtn('am-btn sm dark', 'はい', () => setDone(pn, !done, two)));
        a.appendChild(amBtn('am-btn sm', 'やめる', () => { doneAsk = null; renderDonePns(two); }));
        row.appendChild(a);
      } else {
        row.appendChild(amBtn('am-btn sm', done ? '進行中に戻す' : '完了にする', () => { doneAsk = pn; renderDonePns(two); }));
      }
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  };
  two.appendChild(column('進行中', pns.filter(p => !denkiCompleted.has(p)), false));
  two.appendChild(column('完了済み', pns.filter(p => denkiCompleted.has(p)), true));
}

async function setDone(pn, done, two) {
  const now = new Date().toISOString();
  const res = done
    ? await sb.from('denki_completed_projects').upsert({ project_number: pn, completed_at: now, completed_by: await currentEmail() }, { onConflict: 'project_number' }).select('project_number')
    : await sb.from('denki_completed_projects').delete().eq('project_number', pn).select('project_number');
  if (res.error || !res.data.length) { alert('変更できませんでした（権限がないか、ログインが切れています）。\n' + (res.error ? res.error.message : '')); return; }
  if (done) { denkiCompleted.add(pn); doneAt[pn] = now; } else { denkiCompleted.delete(pn); delete doneAt[pn]; }
  doneAsk = null;
  renderDonePns(two);
  await refreshDisplay();
}

// ─── ステップの設定 ──────────────────────────────────
// 左で項目を選び、右でステップを1つずつ編集する。保存するまで反映しない
let stepDraft = {};     // 工程番号 → 編集中のステップ
let stepSel = null;     // 選んでいる工程番号
let stepMsg = '';       // 「保存しました」など
const stepClean = a => (a || []).map(s => s.trim()).filter(Boolean);
const stepChanged = no => stepClean(stepDraft[no]).join('\n') !== (stepDefs[no] || []).join('\n');

function openSteps(view) {
  stepDraft = {};
  PROCESSES.forEach(p => { stepDraft[p.no] = [...(stepDefs[p.no] || [])]; });
  if (!PROCESSES.some(p => p.no === stepSel)) stepSel = (PROCESSES.find(p => stepDefs[p.no]) || PROCESSES[0]).no;
  stepMsg = '';

  const split = el('div', 'am-split');
  const left = el('div', 'am-card');
  const lhead = el('div', 'am-cardhead');
  lhead.appendChild(el('b', '', '項目'));
  const lcount = el('span', '');
  lhead.appendChild(lcount);
  left.appendChild(lhead);
  const items = el('div', 'am-items');
  left.appendChild(items);
  const right = el('div', 'am-card');
  split.appendChild(left);
  split.appendChild(right);
  view.appendChild(split);
  const foot = el('div', 'am-foot');
  view.appendChild(foot);

  const ui = { items, lcount, right, foot, preview: null };
  renderStepItems(ui);
  renderStepEditor(ui);
  renderStepFoot(ui);
}

// 入力のたびに、左の一覧・見え方・下のボタンだけ描き直す（入力欄は作り直さない）
function stepsUpdated(ui) {
  stepMsg = '';
  adminDirty = PROCESSES.some(p => stepChanged(p.no));
  renderStepItems(ui);
  renderStepPreview(ui);
  renderStepFoot(ui);
}

function renderStepItems(ui) {
  const top = ui.items.scrollTop;
  ui.items.innerHTML = '';
  ui.lcount.textContent = `ステップあり ${PROCESSES.filter(p => stepClean(stepDraft[p.no]).length).length}項目 / ${PROCESSES.length}項目`;
  PROCESSES.forEach(p => {
    const n = stepClean(stepDraft[p.no]).length;
    const b = amBtn('am-item' + (p.no === stepSel ? ' on' : ''), null, () => { stepSel = p.no; renderStepItems(ui); renderStepEditor(ui); });
    b.appendChild(el('b', '', String(p.no)));
    b.appendChild(el('span', 'nm', p.name));
    const meta = el('span', 'meta');
    if (stepChanged(p.no)) { const d = el('i', 'dot'); d.title = '保存していない変更'; meta.appendChild(d); }
    meta.appendChild(el('span', 'am-badge' + (n ? '' : ' none'), n ? String(n) : '—'));
    b.appendChild(meta);
    ui.items.appendChild(b);
  });
  ui.items.scrollTop = top;
}

function renderStepEditor(ui, focusIdx) {
  const p = PROCESSES.find(x => x.no === stepSel);
  const cur = stepDraft[p.no];
  const set = (arr, f) => { stepDraft[p.no] = arr; stepsUpdated(ui); renderStepEditor(ui, f); };
  ui.right.innerHTML = '';

  const head = el('div', 'am-edhead');
  head.appendChild(el('b', 'no', String(p.no)));
  head.appendChild(el('b', 'nm', p.name));
  ui.right.appendChild(head);

  const body = el('div', 'am-edbody');
  const col = el('div', 'am-edcol');
  col.appendChild(el('span', 'am-label', 'ステップ（上から順に進めます）'));
  if (!cur.length) col.appendChild(el('div', 'am-nosteps', 'ステップなし。詳細パネルにステップの欄は出ません。'));
  const inputs = [];
  cur.forEach((text, i) => {
    const row = el('div', 'am-step');
    row.appendChild(el('span', 'n', String(i + 1)));
    const inp = el('input');
    inp.type = 'text'; inp.value = text; inp.placeholder = 'ステップ名';
    inp.addEventListener('input', () => { cur[i] = inp.value; stepsUpdated(ui); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { const a = [...cur]; a.splice(i + 1, 0, ''); set(a, i + 1); } });
    inputs.push(inp);
    row.appendChild(inp);
    const sb_ = (cls, label, title, fn, disabled) => { const b = amBtn('am-sbtn' + cls, label, fn); b.title = title; b.disabled = !!disabled; return b; };
    row.appendChild(sb_('', '▲', '上へ', () => { const a = [...cur]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(a); }, i === 0));
    row.appendChild(sb_('', '▼', '下へ', () => { const a = [...cur]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set(a); }, i === cur.length - 1));
    row.appendChild(sb_(' del', '✕', '削除', () => set(cur.filter((_, k) => k !== i))));
    col.appendChild(row);
  });
  const add = el('div', 'am-stepadd');
  add.appendChild(amBtn('am-dashed', '＋ ステップを追加', () => set([...cur, ''], cur.length)));
  if (cur.length) add.appendChild(amBtn('am-link', 'ステップなしにする', () => set([])));
  col.appendChild(add);
  if ((stepDefs[p.no] || []).length) {
    col.appendChild(el('div', 'am-warn', '並べ替えや削除をしても、入力済みのチェックは「上から何番目か」で残ります。チェック済みの機械がある項目は注意してください。'));
  }
  body.appendChild(col);

  ui.preview = el('div', 'am-preview');
  body.appendChild(ui.preview);
  renderStepPreview(ui);
  ui.right.appendChild(body);
  if (focusIdx != null && inputs[focusIdx]) inputs[focusIdx].focus();
}

// 詳細パネルでの見え方（sheet.js の .dt-steps と同じ見た目）
function renderStepPreview(ui) {
  if (!ui.preview) return;
  ui.preview.innerHTML = '';
  ui.preview.appendChild(el('span', 'am-label', '詳細パネルでの見え方'));
  const steps = stepDraft[stepSel] || [];
  if (!steps.length) { ui.preview.appendChild(el('span', 'am-hint', 'ステップの欄は出ません')); return; }
  const box = el('div', 'dt-steps');
  steps.forEach((s, i) => {
    const r = el('div', 'dt-step' + (i === 0 ? ' next' : ''));
    r.appendChild(el('span', 'dt-check'));
    r.appendChild(el('span', '', s.trim() || '（未入力）'));
    box.appendChild(r);
  });
  ui.preview.appendChild(box);
}

function renderStepFoot(ui) {
  ui.foot.innerHTML = '';
  const changed = PROCESSES.filter(p => stepChanged(p.no));
  ui.foot.appendChild(el('span', 'msg' + (stepMsg ? ' ok' : changed.length ? ' dirty' : ''),
    stepMsg || (changed.length ? `保存していない変更：${changed.length}項目` : '変更はありません')));
  const reset = amBtn('am-btn', '元に戻す', () => {
    PROCESSES.forEach(p => { stepDraft[p.no] = [...(stepDefs[p.no] || [])]; });
    stepsUpdated(ui); renderStepEditor(ui);
  });
  const save = amBtn('am-btn dark', '保存', () => saveSteps(ui, save));
  reset.disabled = save.disabled = !changed.length;
  ui.foot.appendChild(reset);
  ui.foot.appendChild(save);
}

async function saveSteps(ui, btn) {
  btn.disabled = true;
  const email = await currentEmail();
  const ups = [], dels = [];
  PROCESSES.forEach(p => {
    if (!stepChanged(p.no)) return;
    const steps = stepClean(stepDraft[p.no]);
    if (steps.length) ups.push({ process_no: p.no, steps, updated_at: new Date().toISOString(), updated_by: email });
    else dels.push(p.no);
  });
  try {
    if (ups.length) { const r = await sb.from('denki_steps').upsert(ups, { onConflict: 'process_no' }).select('process_no'); if (r.error) throw r.error; if (!r.data.length) throw new Error('権限がないか、ログインが切れています'); }
    if (dels.length) { const r = await sb.from('denki_steps').delete().in('process_no', dels); if (r.error) throw r.error; }
    ups.forEach(u => { stepDefs[u.process_no] = u.steps; });
    dels.forEach(n => { delete stepDefs[n]; });
    PROCESSES.forEach(p => { stepDraft[p.no] = [...(stepDefs[p.no] || [])]; });
    adminDirty = false;
    stepMsg = '保存しました';
    renderStepItems(ui); renderStepEditor(ui); renderStepFoot(ui);
    renderSheet();
  } catch (e) {
    btn.disabled = false;
    alert('保存できませんでした。\n' + (e.message || e));
  }
}
