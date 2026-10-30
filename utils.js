// ─── ユーティリティ ─────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length !== 3) return '';
  return `${parts[0].slice(-2)}/${parts[1]}/${parts[2]}`;
}

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDBDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getStatusClass(status) {
  return { '作業中': 'wip', '確認依頼中': 'wait', '手配中': 'wait', '完了': 'done', '対象外': 'na', '未': 'yet' }[status] || 'pending';
}

function procKey(proj, proc) {
  return `${proj.project_number}__${proj.machine}__${proc.no}`;
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
