// ─── 議事録（v2） ─────────────────────────────────────────
// 会議中に変えたところ（denki_history）から、会議の日ごとに自動で作る。
// 左に会議の日の一覧、右にその日の議事録。文章のコピー・印刷ができる。
// ※ 以前の議事録（denki_minutes など）の表・データはそのまま残しています（この画面には出しません）
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
let meetingDates = [];   // [{ meeting_date, ended_at }] 新しい順
let minutesDate = null;  // 表示している会議の日
let minutesRows = [];    // その日の記録

function todayStr() { return toDBDate(new Date()); }
function fmtMeetingDate(s) {
  if (!s) return '';
  const d = parseLocalDate(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}
async function currentEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || null;
}

async function showMinutes(date) {
  const { data, error } = await sb.from('denki_meetings').select('meeting_date, ended_at').order('meeting_date', { ascending: false });
  meetingDates = error ? [] : data;
  if (date && meetingDates.some(m => m.meeting_date === date)) minutesDate = date;
  else if (!minutesDate || !meetingDates.some(m => m.meeting_date === minutesDate)) minutesDate = meetingDates[0]?.meeting_date || null;
  renderMinutesSide();
  await loadMinutesRows();
  renderMinutesMain();
}

async function loadMinutesRows() {
  minutesRows = [];
  if (!minutesDate) return;
  const { data, error } = await sb.from('denki_history').select('*').eq('meeting_date', minutesDate);
  if (error) { alert('議事録を読み込めませんでした。\n' + error.message); return; }
  minutesRows = data;
}

function renderMinutesSide() {
  const box = document.getElementById('minutes-side');
  box.innerHTML = '';
  box.appendChild(el('div', 'mn-side-title', '会議の日'));
  if (!meetingDates.length) { box.appendChild(el('div', 'mn-muted', 'まだ会議の記録はありません')); return; }
  const list = el('div', 'mn-dates');
  meetingDates.forEach(m => {
    const b = el('button', 'mn-date' + (m.meeting_date === minutesDate ? ' on' : ''));
    b.type = 'button';
    b.appendChild(el('span', '', fmtMeetingDate(m.meeting_date)));
    if (m.meeting_date === todayStr() && !m.ended_at) b.appendChild(el('span', 'mn-live', '会議中'));
    b.addEventListener('click', async () => { minutesDate = m.meeting_date; renderMinutesSide(); await loadMinutesRows(); renderMinutesMain(); });
    list.appendChild(b);
  });
  box.appendChild(list);
}

// 工番 → 機械 → 項目の順に並べる
function minutesGroups() {
  const order = new Map(allColumns.map((c, i) => [`${c.project_number}|${c.machine}`, i]));
  const rows = [...minutesRows].sort((a, b) =>
    (b.project_number === GLOBAL_PN) - (a.project_number === GLOBAL_PN) // 全体の決定事項を先頭に
    || a.project_number.localeCompare(b.project_number)
    || (order.get(`${a.project_number}|${a.machine}`) ?? 999) - (order.get(`${b.project_number}|${b.machine}`) ?? 999)
    || String(a.machine).localeCompare(String(b.machine))
    || (a.process_no || 99) - (b.process_no || 99));
  const groups = [];
  rows.forEach(r => {
    let g = groups.find(x => x.pn === r.project_number);
    if (!g) groups.push(g = { pn: r.project_number, cust: r.project_number === GLOBAL_PN ? '工番によらないこと' : customerOf[r.project_number] || '', machines: [] });
    let m = g.machines.find(x => x.name === r.machine);
    if (!m) g.machines.push(m = { name: r.machine, items: [] });
    m.items.push({
      no: r.process_no ? String(r.process_no) : '－',
      name: procName(r.process_no, r.project_number),
      lines: (r.changed || []).map(f => ({ k: SNAP_LABELS[f], v: f === 'memo' ? (r.cur[f] || '（なし）') : `${histValue(f, r.base[f])} → ${histValue(f, r.cur[f])}` })),
    });
  });
  return groups;
}

function minutesTitle() { return `${fmtMeetingDate(minutesDate)} 電気工程確認会議`; }

function minutesText(groups) {
  const out = [minutesTitle(), ''];
  groups.forEach(g => {
    out.push(`■ ${g.pn} ${g.cust}`);
    g.machines.forEach(m => {
      if (m.name) out.push(`【${m.name}】`);
      m.items.forEach(it => {
        out.push(`${it.no} ${it.name}`);
        it.lines.forEach(l => out.push(`　${l.k}：${String(l.v).replace(/\n/g, '\n　　')}`));
      });
    });
    out.push('');
  });
  return out.join('\n');
}

function renderMinutesMain() {
  const box = document.getElementById('minutes-main');
  box.innerHTML = '';
  if (!minutesDate) {
    box.appendChild(el('div', 'mn-empty', '議事録はまだありません。進捗確認表の上の「会議を始める」を押すと、それ以降の変更が議事録に記録されます。'));
    return;
  }
  const groups = minutesGroups();
  const head = el('div', 'mn-head');
  head.appendChild(el('b', 'mn-title', minutesTitle()));
  const copy = el('button', 'mn-btn dark', '文章をコピー');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(minutesText(groups)); copy.textContent = 'コピーしました'; }
    catch (_) { alert('コピーできませんでした。'); }
  });
  const print = el('button', 'mn-btn', '印刷・PDF');
  print.type = 'button';
  print.addEventListener('click', () => printMinutes(groups));
  head.appendChild(copy); head.appendChild(print);
  box.appendChild(head);

  const body = el('div', 'mn-body');
  if (!groups.length) {
    const live = minutesDate === todayStr() && meetingActive();
    body.appendChild(el('div', 'mn-empty', live ? '今回の会議では、まだ変更がありません' : 'この日の記録はありません'));
  }
  groups.forEach(g => {
    const gb = el('div', 'mn-group');
    const gh = el('div', 'mn-pn');
    gh.appendChild(el('b', '', g.pn)); gh.appendChild(el('span', '', g.cust));
    gb.appendChild(gh);
    g.machines.forEach(m => {
      const mb = el('div', 'mn-machine');
      if (m.name) mb.appendChild(el('b', 'mn-mname', m.name));
      m.items.forEach(it => {
        const ib = el('div', 'mn-item');
        ib.appendChild(el('span', 'mn-no', it.no));
        const c = el('div', 'mn-itembody');
        c.appendChild(el('b', '', it.name));
        it.lines.forEach(l => {
          const ln = el('div', 'mn-line');
          ln.appendChild(el('span', 'mn-k', l.k));
          ln.appendChild(el('span', 'mn-v', l.v));
          c.appendChild(ln);
        });
        ib.appendChild(c);
        mb.appendChild(ib);
      });
      gb.appendChild(mb);
    });
    body.appendChild(gb);
  });
  box.appendChild(body);
}

// 印刷用のページを別のウィンドウで開く（印刷画面で「PDFに保存」を選ぶとPDF）
function printMinutes(groups) {
  const w = window.open('', '_blank');
  if (!w) { alert('ポップアップが止められています。許可してからもう一度押してください。'); return; }
  const esc = escapeHtml;
  const html = groups.map(g => `<h2>${esc(g.pn)} <small>${esc(g.cust)}</small></h2>` + g.machines.map(m =>
    (m.name ? `<h3>${esc(m.name)}</h3>` : '') + m.items.map(it => `<div class="it"><b>${esc(it.no)} ${esc(it.name)}</b>` +
      it.lines.map(l => `<div class="ln"><span>${esc(l.k)}</span>${esc(l.v).replace(/\n/g, '<br>')}</div>`).join('') + '</div>').join('')).join('')).join('');
  w.document.write(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${esc(minutesTitle())}</title><style>
    @page{size:A4;margin:16mm}body{font-family:'Noto Sans JP','メイリオ',sans-serif;color:#222;font-size:10.5pt;line-height:1.6}
    h1{font-size:15pt;margin:0 0 10pt}h2{font-size:12pt;background:#e3e7ec;padding:3pt 8pt;margin:14pt 0 6pt}h2 small{font-weight:400;font-size:10pt}
    h3{font-size:11pt;margin:8pt 0 4pt 4pt}.it{margin:0 0 6pt 12pt;break-inside:avoid}.ln{margin-left:12pt}.ln span{display:inline-block;min-width:5em;color:#555;font-weight:700}
  </style></head><body><h1>${esc(minutesTitle())}</h1>${html || '<p>この日の記録はありません</p>'}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
