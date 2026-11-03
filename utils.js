// ─── ユーティリティ ─────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length !== 3) return '';
  return `${parts[0].slice(-2)}/${parts[1]}/${parts[2]}`;
}

// ガントの開始・終了欄用（今年なら 11/4、それ以外は 27/1/12）
function fmtMD(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('T')[0].split('-').map(Number);
  if (!y) return '';
  return (y !== new Date().getFullYear() ? `${String(y).slice(-2)}/` : '') + `${m}/${d}`;
}

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDBDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(s) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s ?? '').replace(/[&<>"']/g, c => map[c]);
}

function getStatusClass(status) {
  return { '作業中': 'wip', '確認依頼中': 'wait', '手配中': 'wait', '完了': 'done', '対象外': 'na', '未': 'yet' }[status] || 'pending';
}

function procKey(proj, proc) {
  return `${proj.project_number}__${proj.machine}__${proc.no}`;
}

// 機種名の照合。「DF,RV」「RA＆RG」のような複数機種のまとめ書きは分解して、どれかが一致すれば同じ機種とみなす
function splitMachines(m) {
  return String(m || '').split(/[,，、\/／＆&・]/).map(s => s.trim()).filter(Boolean);
}
function machineMatches(columnMachine, taskMachine) {
  const c = String(columnMachine || '').trim();
  const t = String(taskMachine || '').trim();
  if (!t) return false; // 機種が空欄のタスクは「工番共通・その他」に出す
  if (c === t) return true;
  const cs = splitMachines(c), ts = splitMachines(t);
  return cs.some(x => ts.includes(x));
}

// タスクリストの1マス（列×項目）のステータス
function statusOf(proj, proc) {
  return (statusMap[procKey(proj, proc)] || {}).status || '';
}

// 列ごとの進み具合（対象外を除いた項目のうち完了の数）
function progressOf(proj) {
  let done = 0, total = 0;
  PROCESSES.forEach(proc => {
    const s = statusOf(proj, proc);
    if (s === '対象外') return;
    total++;
    if (s === '完了') done++;
  });
  return { done, total };
}

// 工程表の工程に必要なタスクリストの項目の進み具合（config.js の PROCESS_MAP）
function relProgressByNos(proj, nos) {
  let done = 0, total = 0;
  nos.forEach(no => {
    const s = statusOf(proj, { no });
    if (s === '対象外') return;
    total++;
    if (s === '完了') done++;
  });
  return { done, total };
}
function relProgress(proj, taskText) {
  const m = processMapOf(taskText);
  if (!m || !proj) return null;
  return { ...relProgressByNos(proj, m.nos), nos: m.nos };
}

// 工程の状態: done 完了 / late 遅れ / soon 注意 / active 進行中 / plan 予定
function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function taskState(t) {
  if (t.is_completed) return 'done';
  if (!t.start_date) return 'plan';
  const today = todayStart();
  const start = parseLocalDate(t.start_date);
  const end = parseLocalDate(t.end_date || t.start_date);
  const days = Math.round((end - today) / 86400000);
  if (days < 0) return 'late';
  if (days <= WARN_DAYS) return 'soon';
  return start <= today ? 'active' : 'plan';
}

// 「自分の担当」: 全体工程表の担当者（カンマ区切りなど）に、ログイン中の人の名前が含まれるか
function ownerMatchesMe(owner) {
  const me = String(myName || '').replace(/[\s　]/g, '');
  if (!me || !owner) return false;
  return String(owner).split(/[,，、\/／\s　]+/).filter(Boolean)
    .some(o => me.includes(o) || o.includes(me));
}

// ─── 議事録の書式付き本文 ───────────────────────────────
// 保存・表示の前に、改行・文字の色・取り消し線だけを残す（それ以外のタグや属性は捨てる）
function sanitizeRich(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const out = document.createElement('div');
  const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i;
  const walk = (src, dst) => src.childNodes.forEach(n => {
    if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'BR') { dst.appendChild(document.createElement('br')); return; }
    let el;
    if (tag === 'DIV' || tag === 'P' || tag === 'LI') el = document.createElement('div');
    else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') el = document.createElement('s');
    else el = document.createElement('span');
    const color = ((n.style && n.style.color) || n.getAttribute('color') || '').trim();
    if (color && COLOR.test(color)) el.style.color = color;
    const deco = (n.style && (n.style.textDecorationLine || n.style.textDecoration)) || '';
    if (deco.includes('line-through')) el.style.textDecoration = 'line-through';
    walk(n, el);
    dst.appendChild(el);
  });
  walk(tpl.content, out);
  return out.innerHTML;
}
// 以前の文字だけの本文は、改行ごとに行にして表示する
function richFromStored(body) {
  if (!body) return '';
  if (/<[a-z][\s\S]*>/i.test(body)) return sanitizeRich(body);
  return String(body).split('\n').map(l => `<div>${escapeHtml(l) || '<br>'}</div>`).join('');
}
function isBlankRich(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return !d.textContent.trim();
}

// 1000 件を超える取得用（Supabase は 1 回 1000 件まで）
async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}
