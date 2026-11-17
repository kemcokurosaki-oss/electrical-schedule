// ─── 管理者メニュー（v2） ─────────────────────────────────
// 「管理」ボタンで 工番・機械の登録（manage.js）／完了工番／ステップの設定 を選ぶ
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
document.getElementById('btn-done-pns').addEventListener('click', openDonePns);
document.getElementById('btn-steps').addEventListener('click', openSteps);

const adminModal = document.getElementById('admin-modal');
const adminBox = document.getElementById('admin-modal-box');
let adminDirty = false;
adminModal.addEventListener('click', e => { if (e.target.dataset.close) closeAdmin(); });
function openAdmin(cls) { adminBox.className = 'v2-modal-box ' + cls; adminModal.hidden = false; adminDirty = false; }
function closeAdmin() {
  if (adminDirty && !confirm('保存していない変更があります。閉じてもいいですか？')) return;
  adminModal.hidden = true; adminBox.innerHTML = '';
}
function adminHead(title) {
  const h = el('div', 'am-head');
  h.appendChild(el('b', 'am-title', title));
  const x = el('button', 'am-close', '✕');
  x.type = 'button'; x.title = '閉じる';
  x.addEventListener('click', closeAdmin);
  h.appendChild(x);
  return h;
}

// ─── 完了工番 ───────────────────────────────────────
// 工番単位で完了にする。完了にした工番は表示しないだけで、データは残る
async function openDonePns() {
  openAdmin('am-done');
  adminBox.innerHTML = '';
  adminBox.appendChild(adminHead('完了工番'));
  const body = el('div', 'am-body');
  body.appendChild(el('div', 'am-muted', '読み込み中…'));
  adminBox.appendChild(body);
  // 客先名が無い工番（完了済みなど）は全体工程表から拾う
  const pns = [...new Set(allColumns.map(c => c.project_number))];
  const missing = pns.filter(pn => !customerOf[pn]);
  if (missing.length) {
    try {
      const rows = await fetchAll(() => sb.from('tasks').select('project_number, customer_name').in('project_number', missing).not('customer_name', 'is', null));
      rows.forEach(r => { if (!customerOf[r.project_number]) customerOf[r.project_number] = r.customer_name; });
    } catch (_) { /* 客先名なしで表示 */ }
  }
  renderDonePns(body);
}

function renderDonePns(body) {
  body.innerHTML = '';
  body.appendChild(el('div', 'am-hint', '工番を押すと、もう一方の一覧へ移します。完了にした工番は進捗確認表に出なくなりますが、データは残ります。'));
  const pns = [...new Set(allColumns.map(c => c.project_number))];
  const cols = el('div', 'am-two');
  const list = (title, items, done) => {
    const box = el('div', 'am-col');
    box.appendChild(el('div', 'am-colhead', `${title}（${items.length}）`));
    const ul = el('div', 'am-list');
    if (!items.length) ul.appendChild(el('div', 'am-muted', done ? '完了した工番はありません' : '進行中の工番はありません'));
    items.forEach(pn => {
      const b = el('button', 'am-pn');
      b.type = 'button';
      b.appendChild(el('b', '', pn));
      b.appendChild(el('span', '', customerOf[pn] || ''));
      b.appendChild(el('span', 'am-move', done ? '← 進行中に戻す' : '完了にする →'));
      b.addEventListener('click', () => setDone(pn, !done, body));
      ul.appendChild(b);
    });
    box.appendChild(ul);
    return box;
  };
  cols.appendChild(list('進行中', pns.filter(p => !denkiCompleted.has(p)), false));
  cols.appendChild(list('完了済み', pns.filter(p => denkiCompleted.has(p)), true));
  body.appendChild(cols);
}

async function setDone(pn, done, body) {
  const msg = done ? `${pn} を完了にします。\n進捗確認表に出なくなります（データは残ります）。よろしいですか？`
                   : `${pn} を進行中に戻します。よろしいですか？`;
  if (!confirm(msg)) return;
  const res = done
    ? await sb.from('denki_completed_projects').upsert({ project_number: pn, completed_at: new Date().toISOString(), completed_by: await currentEmail() }, { onConflict: 'project_number' }).select('project_number')
    : await sb.from('denki_completed_projects').delete().eq('project_number', pn).select('project_number');
  if (res.error || !res.data.length) { alert('変更できませんでした（権限がないか、ログインが切れています）。\n' + (res.error ? res.error.message : '')); return; }
  if (done) denkiCompleted.add(pn); else denkiCompleted.delete(pn);
  renderDonePns(body);
  await refreshDisplay();
}

// ─── ステップの設定 ──────────────────────────────────
// 項目ごとに、1行に1つずつステップを書く。空にするとステップなし
async function openSteps() {
  openAdmin('am-steps');
  adminBox.innerHTML = '';
  adminBox.appendChild(adminHead('ステップの設定'));
  const body = el('div', 'am-body');
  body.appendChild(el('div', 'am-hint', '1行に1つずつ書きます。空にするとステップなし。並び順を入れ替えると、すでに付けたチェックの位置はそのまま（上から何番目か）なので注意してください。'));
  const list = el('div', 'am-steplist');
  const inputs = {};
  PROCESSES.forEach(p => {
    const row = el('div', 'am-steprow');
    const lab = el('div', 'am-steplab');
    lab.appendChild(el('b', '', String(p.no)));
    lab.appendChild(el('span', '', p.name));
    row.appendChild(lab);
    const ta = el('textarea', 'am-stepinput');
    ta.value = (stepDefs[p.no] || []).join('\n');
    ta.rows = Math.max(1, (stepDefs[p.no] || []).length);
    ta.placeholder = 'ステップなし';
    ta.addEventListener('input', () => { adminDirty = true; ta.rows = Math.max(1, ta.value.split('\n').length); });
    inputs[p.no] = ta;
    row.appendChild(ta);
    list.appendChild(row);
  });
  body.appendChild(list);
  adminBox.appendChild(body);

  const foot = el('div', 'am-foot');
  const cancel = el('button', 'mn-btn', 'やめる'); cancel.type = 'button'; cancel.addEventListener('click', closeAdmin);
  const save = el('button', 'mn-btn dark', '保存'); save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    const email = await currentEmail();
    const ups = [], dels = [];
    PROCESSES.forEach(p => {
      const steps = inputs[p.no].value.split('\n').map(s => s.trim()).filter(Boolean);
      const old = stepDefs[p.no] || [];
      if (steps.join('\n') === old.join('\n')) return;
      if (steps.length) ups.push({ process_no: p.no, steps, updated_at: new Date().toISOString(), updated_by: email });
      else dels.push(p.no);
    });
    try {
      if (ups.length) { const r = await sb.from('denki_steps').upsert(ups, { onConflict: 'process_no' }).select('process_no'); if (r.error) throw r.error; if (!r.data.length) throw new Error('権限がないか、ログインが切れています'); }
      if (dels.length) { const r = await sb.from('denki_steps').delete().in('process_no', dels); if (r.error) throw r.error; }
      ups.forEach(u => { stepDefs[u.process_no] = u.steps; });
      dels.forEach(n => { delete stepDefs[n]; });
      adminDirty = false;
      closeAdmin();
      renderSheet();
    } catch (e) {
      save.disabled = false;
      alert('保存できませんでした。\n' + (e.message || e));
    }
  });
  foot.appendChild(cancel); foot.appendChild(save);
  adminBox.appendChild(foot);
}
