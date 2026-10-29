const SVG_EXPAND   = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M0,4 L0,0 L4,0 L4,1.5 L1.5,1.5 L1.5,4 Z M8,0 L12,0 L12,4 L10.5,4 L10.5,1.5 L8,1.5 Z M0,8 L1.5,8 L1.5,10.5 L4,10.5 L4,12 L0,12 Z M8,10.5 L10.5,10.5 L10.5,8 L12,8 L12,12 L8,12 Z"/></svg>`;
const SVG_COLLAPSE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M4,0 L4,4 L0,4 L0,2.5 L2.5,2.5 L2.5,0 Z M8,0 L9.5,0 L9.5,2.5 L12,2.5 L12,4 L8,4 Z M0,8 L4,8 L4,12 L2.5,12 L2.5,9.5 L0,9.5 Z M8,8 L12,8 L12,9.5 L9.5,9.5 L9.5,12 L8,12 Z"/></svg>`;

// ─── ユーティリティ ─────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length !== 3) return '';
  return `${parts[0].slice(-2)}/${parts[1]}/${parts[2]}`;
}

function fmtDateRange(start, end) {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s && e) return `${s}～${e}`;
  if (s) return `${s}～`;
  return '';
}

function getStatusClass(status) {
  return { '作業中': 'wip', '確認依頼中': 'wait', '手配中': 'wait', '完了': 'done', '対象外': 'na', '未': 'yet' }[status] || 'pending';
}

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 連携工程でステータス未入力のとき: 開始日を過ぎていれば作業中
function autoStatus(startDate) {
  const start = parseLocalDate(startDate);
  if (!start) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today < start ? '' : '作業中';
}

function procKey(proj, proc) {
  return `${proj.project_number}__${proj.machine}__${proc.no}`;
}

// 1つのセル（列×工程）の表示内容。連携工程で全体工程表のタスクがあれば、日付・担当者・完了はタスクのもの
function getProcData(proj, proc) {
  const rec  = statusMap[procKey(proj, proc)] || {};
  const task = proc.linked ? linkedMap[procKey(proj, proc)] : null;
  if (task) {
    const inputStatus = task.completed ? '完了' : (rec.status || '');
    return {
      linked: true, taskId: task.id,
      start_date: task.start_date, end_date: task.end_date, owner: task.owner,
      inputStatus, status: inputStatus || autoStatus(task.start_date), memo: rec.memo || null,
    };
  }
  return {
    linked: false,
    start_date: rec.start_date || null, end_date: rec.end_date || null, owner: rec.tantousha || '',
    inputStatus: rec.status || '', status: rec.status || '', memo: rec.memo || null,
  };
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

function applyStatusStyle(dateTd, statusTd, statusSpan, status) {
  dateTd.classList.remove('proc-done', 'proc-na');
  statusTd.classList.remove('proc-done', 'proc-wip', 'proc-wait', 'proc-yet');
  statusSpan.className = 'status-label';
  statusSpan.textContent = status || '';
  statusSpan.style.display = status ? '' : 'none';
  const cls = getStatusClass(status);
  if (cls === 'done' || cls === 'na') dateTd.classList.add('proc-' + cls);
  if (cls !== 'pending' && cls !== 'na') statusTd.classList.add('proc-' + cls);
  if (cls !== 'pending') statusSpan.classList.add('lbl-' + cls);
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}
