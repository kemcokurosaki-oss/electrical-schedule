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
  return { '作業中': 'wip', '完了': 'done', '対象外': 'na' }[status] || 'pending';
}

function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function calcLinkedStatus(startDate, endDate, taskStatus) {
  if (taskStatus === '完了') return '完了';
  if (!startDate) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = parseLocalDate(startDate);
  if (!start || today < start) return '';
  return '作業中';
}

function applyStatusStyle(dateTd, statusTd, statusSpan, status) {
  dateTd.classList.remove('proc-done', 'proc-na');
  statusTd.classList.remove('proc-done', 'proc-wip');
  statusSpan.className = 'status-label';
  statusSpan.textContent = status || '';
  statusSpan.style.display = status ? '' : 'none';
  switch (status) {
    case '完了':
      dateTd.classList.add('proc-done');
      statusTd.classList.add('proc-done');
      statusSpan.classList.add('lbl-done');
      break;
    case '作業中':
      statusTd.classList.add('proc-wip');
      statusSpan.classList.add('lbl-wip');
      break;
    case '対象外':
      dateTd.classList.add('proc-na');
      statusSpan.classList.add('lbl-na');
      break;
  }
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}
