// ─── 進捗確認表（v2） ─────────────────────────────────────
// 1台の機械を1行、項目（config.js の PROCESSES）を横に並べる。マスを押すと右に詳細表示。
//   予定日・状態 … denki_process_status（予定日は start_date・end_date に同じ日付）
//   対応中・期限・ステップ … denki_item_info
//   自由メモ … denki_item_memos（項目 0 は機械ごとの「その他のメモ」）
//   会議中に変えたところは denki_history に自動で記録し、議事録になる（minutes.js）
let itemMemos = {};   // noteKey → { body, updated_at }
let itemInfo = {};    // noteKey → { ball, due_date, steps, updated_at }
let stepDefs = {};    // 項目番号 → ステップ名の配列
let sheetPn = null;   // 表示する工番（null はすべて）
let sheetSel = null;  // 選んでいるマス { pn, machine, no }
const groupOpenOverride = {}; // 段階の開閉を押して変えたもの
try { sheetPn = localStorage.getItem('denki_sheet_pn') || null; } catch (_) { /* 覚えていなければ全部 */ }

const SHEET_OTHER_NO = 0;
const SHEET_GROUPS = [
  { name: '設計情報の入手', from: 1, to: 7 },
  { name: '機器・操作盤', from: 8, to: 12 },
  { name: '電気図面・手配', from: 13, to: 17 },
  { name: '製作・試運転', from: 18, to: 22 },
];
// 列の見出しに出す短い名前
const PROC_SHORT = { 1: '既設図面', 2: 'リスト', 3: '部品表\nM・C', 4: '部品表\nM・S・I', 5: 'エア回路', 6: '油圧回路', 7: '運転方案',
  8: '先行手配', 9: '機器リスト', 10: 'リスト確認', 11: '外形図', 12: '外形図確認', 13: '電気図面', 14: '部品手配', 15: '確認用図',
  16: '確認用確認', 17: '最終図面', 18: '部品入荷', 19: '艤装開始', 20: '盤組開始', 21: '盤立上げ', 22: '試運転' };
const BALL_ROWS = [['M', 'E', 'S', 'A'], ['資材', '客先', '代理店']];
const ST_CLASS = { '作業中': 'wip', '確認依頼中': 'wait', '手配中': 'order', '完了': 'done', '対象外': 'na', '未': 'yet' };
const SNAP_FIELDS = ['st', 'sched', 'step', 'ball', 'due', 'memo'];
const SNAP_LABELS = { st: '状態', sched: '予定日', step: 'ステップ', ball: '対応中', due: '期限', memo: '自由メモ' };
const TRUCK_SVG = '<svg class="v2-truck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5h11v9h-11z M13.5 9.5h4l3 3v3h-7z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>';

function noteKey(pn, machine, no) { return `${pn}|${machine || ''}|${no || 0}`; }
function procName(no) { return no ? (PROCESSES.find(p => p.no === no) || {}).name || '' : 'その他のメモ'; }
function recOf(pn, machine, no) { return statusMap[`${pn}__${machine}__${no}`] || {}; }
function dateOf(rec) { return rec.end_date || rec.start_date || ''; }
function daysFromToday(d) { return Math.round((parseLocalDate(d) - todayStart()) / 86400000); }
function dueOf(rec) {
  const d = dateOf(rec);
  if (!d || rec.status === '完了' || rec.status === '対象外') return '';
  const n = daysFromToday(d);
  return n < 0 ? 'late' : n <= WARN_DAYS ? 'soon' : '';
}
// 対象外以外は予定日が必須
function isMissingDate(rec) { return rec.status !== '対象外' && !dateOf(rec); }
function md(d) { if (!d) return ''; const x = parseLocalDate(d); return `${x.getMonth() + 1}/${x.getDate()}`; }
function ymd(d) { if (!d) return ''; const x = parseLocalDate(d); return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`; }
function memoOf(pn, machine, no) { return (itemMemos[noteKey(pn, machine, no)] || {}).body || ''; }
function infoOf(pn, machine, no) { return itemInfo[noteKey(pn, machine, no)] || {}; }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setSheetPn(pn) {
  sheetPn = pn;
  try { if (pn) localStorage.setItem('denki_sheet_pn', pn); else localStorage.removeItem('denki_sheet_pn'); } catch (_) { /* 覚えられなくても表示はする */ }
}
function sheetCols() { return currentProjects.filter(p => !sheetPn || p.project_number === sheetPn); }
function sheetGroups(cols) {
  const groups = [];
  cols.forEach(p => {
    const last = groups[groups.length - 1];
    if (last && last.pn === p.project_number) last.cols.push(p);
    else groups.push({ pn: p.project_number, customer: p.customer_name, cols: [p] });
  });
  return groups;
}
function shipDateOf(col) {
  const t = (ganttTasks[`${col.project_number}__${col.machine}`] || []).find(x => String(x.text || '').trim() === '工場出荷');
  return t ? (t.end_date || t.start_date || '') : '';
}
// 段階の全部の項目が完了・対象外なら、最初は閉じて表示する
function groupIsOpen(g, cols) {
  if (groupOpenOverride[g.name] !== undefined) return groupOpenOverride[g.name];
  return !cols.every(c => { for (let no = g.from; no <= g.to; no++) { const s = recOf(c.project_number, c.machine, no).status; if (s !== '完了' && s !== '対象外') return false; } return true; });
}

// ステップのチェック（保存が無ければ、状態が完了なら全部チェック済みとして見せる）
function stepChecks(pn, machine, no) {
  const defs = stepDefs[no] || [];
  const saved = infoOf(pn, machine, no).steps;
  const done = recOf(pn, machine, no).status === '完了';
  return defs.map((_, i) => Array.isArray(saved) && saved[i] !== undefined ? !!saved[i] : done);
}
function stepText(pn, machine, no) {
  const defs = stepDefs[no] || [];
  if (!defs.length) return '';
  const n = stepChecks(pn, machine, no).filter(Boolean).length;
  return n === defs.length ? 'すべて完了' : `${n} / ${defs.length}`;
}
// 議事録用に、項目の今の内容をまとめる
function snapOf(pn, machine, no) {
  const r = no ? recOf(pn, machine, no) : {}, inf = infoOf(pn, machine, no);
  return { st: r.status || '', sched: dateOf(r), step: no ? stepText(pn, machine, no) : '', ball: inf.ball || '', due: inf.due_date || '', memo: memoOf(pn, machine, no) };
}

// ─── 表 ─────────────────────────────────────────────
function renderSheet() {
  const wrap = document.getElementById('sheet-wrap');
  if (sheetPn && !currentProjects.some(p => p.project_number === sheetPn)) setSheetPn(null);
  if (sheetSel && !currentProjects.some(p => p.project_number === sheetSel.pn && p.machine === sheetSel.machine)) sheetSel = null;
  if (!currentProjects.length) {
    wrap.innerHTML = '<div class="no-data">表示する工番がありません。管理者メニューの「工番・機械の登録」から追加してください。</div>';
    renderDetail();
    return;
  }
  const cols = sheetCols();
  const opens = SHEET_GROUPS.map(g => groupIsOpen(g, cols));
  const scroll = { l: wrap.scrollLeft, t: wrap.scrollTop };
  const grid = el('div', 'v2-grid');

  const head = el('div', 'v2-head');
  head.appendChild(el('div', 'v2-corner'));
  SHEET_GROUPS.forEach((g, i) => {
    const gh = el('div', 'v2-gh' + (opens[i] ? '' : ' closed'));
    const t = el('button', 'v2-gtitle');
    t.type = 'button';
    t.title = '押すとたたむ／開く';
    t.innerHTML = `<span class="v2-caret">${opens[i] ? '▼' : '▶'}</span><span></span>`;
    t.lastChild.textContent = opens[i] ? g.name : `${g.from}～${g.to}`;
    t.addEventListener('click', () => { groupOpenOverride[g.name] = !opens[i]; renderSheet(); });
    gh.appendChild(t);
    if (opens[i]) {
      const nums = el('div', 'v2-nums');
      for (let no = g.from; no <= g.to; no++) {
        const n = el('div', 'v2-num' + (sheetSel && sheetSel.no === no ? ' sel' : ''));
        n.title = `${no} ${procName(no)}`;
        n.appendChild(el('b', '', String(no)));
        n.appendChild(el('span', '', PROC_SHORT[no] || ''));
        nums.appendChild(n);
      }
      gh.appendChild(nums);
    } else {
      const s = el('div', 'v2-num-closed', g.name);
      gh.appendChild(s);
    }
    head.appendChild(gh);
  });
  const sh = el('div', 'v2-gh v2-ship-h');
  sh.innerHTML = `<span class="v2-ship-label">${TRUCK_SVG}工場出荷</span>`;
  head.appendChild(sh);
  grid.appendChild(head);

  sheetGroups(cols).forEach(g => {
    const block = el('div', 'v2-pnblock');
    const pr = el('div', 'v2-pnrow');
    const lab = el('div', 'v2-pnlabel');
    lab.title = g.customer || '';
    lab.appendChild(el('b', '', g.pn));
    lab.appendChild(el('span', '', g.customer || ''));
    pr.appendChild(lab);
    block.appendChild(pr);
    g.cols.forEach(col => block.appendChild(machineRow(col, opens)));
    grid.appendChild(block);
  });

  wrap.innerHTML = '';
  wrap.appendChild(grid);
  wrap.scrollLeft = scroll.l; wrap.scrollTop = scroll.t;
  renderDetail();
}

function machineRow(col, opens) {
  const pn = col.project_number, machine = col.machine;
  const row = el('div', 'v2-row' + (sheetSel && sheetSel.pn === pn && sheetSel.machine === machine ? ' sel-row' : ''));
  const pr = progressOf(col);
  const m = el('button', 'v2-mcell');
  m.type = 'button';
  m.title = `${pn} ${machine}　対象外を除く ${pr.total} 項目のうち ${pr.done} 項目が完了\n押すと「その他のメモ」を開きます`;
  m.innerHTML = '<div class="v2-mtop"><b class="v2-mname"></b><span class="v2-mprog"></span></div><div class="v2-bar"><i></i></div>';
  m.querySelector('.v2-mname').textContent = machine || '(機種なし)';
  m.querySelector('.v2-mprog').textContent = `${pr.done}/${pr.total}`;
  m.querySelector('.v2-bar i').style.width = (pr.total ? Math.round(pr.done / pr.total * 100) : 0) + '%';
  if (memoOf(pn, machine, SHEET_OTHER_NO)) m.appendChild(el('span', 'v2-dot'));
  if (sheetSel && sheetSel.pn === pn && sheetSel.machine === machine && sheetSel.no === SHEET_OTHER_NO) m.classList.add('sel');
  m.addEventListener('click', () => selectCell(pn, machine, SHEET_OTHER_NO));
  row.appendChild(m);

  SHEET_GROUPS.forEach((g, i) => {
    const box = el('div', 'v2-gcells' + (opens[i] ? '' : ' closed'));
    if (opens[i]) {
      for (let no = g.from; no <= g.to; no++) box.appendChild(sheetCell(col, no));
    } else {
      let d = 0, t = 0;
      for (let no = g.from; no <= g.to; no++) { const s = recOf(pn, machine, no).status; if (s === '対象外') continue; t++; if (s === '完了') d++; }
      const s = el('button', 'v2-gsum' + (t === d ? ' all' : ''), t === 0 ? '対象外' : t === d ? '✓ 完了' : `${d}/${t} 完了`);
      s.type = 'button';
      s.title = `${g.name}（押すと開く）`;
      s.addEventListener('click', () => { groupOpenOverride[g.name] = true; renderSheet(); });
      box.appendChild(s);
    }
    row.appendChild(box);
  });

  const ship = el('div', 'v2-shipcell');
  const sd = shipDateOf(col);
  if (sd) {
    const n = daysFromToday(sd);
    const b = el('span', 'v2-shipbadge' + (n >= 0 && n <= 14 ? ' near' : ''), ymd(sd));
    b.title = '全体工程表の「工場出荷」の日付';
    ship.appendChild(b);
    if (n >= 0 && n <= 14) ship.appendChild(el('span', 'v2-shipsub', n === 0 ? '今日' : `あと${n}日`));
  } else ship.appendChild(el('span', 'v2-ship-none', '─'));
  row.appendChild(ship);
  return row;
}

function sheetCell(col, no) {
  const pn = col.project_number, machine = col.machine;
  const rec = recOf(pn, machine, no), st = rec.status || '';
  const cls = ST_CLASS[st] || 'pending', due = dueOf(rec), miss = isMissingDate(rec);
  const c = el('button', `v2-cell c-${cls}${due ? ' due-' + due : ''}${miss ? ' missing' : ''}`);
  c.type = 'button';
  c.textContent = st === '対象外' ? '' : miss ? '日付なし' : md(dateOf(rec));
  if (memoOf(pn, machine, no)) c.appendChild(el('span', 'v2-dot'));
  if (sheetSel && sheetSel.pn === pn && sheetSel.machine === machine && sheetSel.no === no) c.classList.add('sel');
  c.title = `${no} ${procName(no)}\n${st || '状態なし'}　${dateOf(rec) ? ymd(dateOf(rec)) : '予定日なし'}${due === 'late' ? '（遅れ）' : due === 'soon' ? '（注意）' : ''}`;
  c.addEventListener('click', () => selectCell(pn, machine, no));
  return c;
}

// ─── 詳細表示 ─────────────────────────────────────────
let detailHist = { key: null, rows: [] };

async function selectCell(pn, machine, no) {
  await flushDetailMemo();
  if (sheetSel && sheetSel.pn === pn && sheetSel.machine === machine && sheetSel.no === no) { sheetSel = null; renderSheet(); return; }
  sheetSel = { pn, machine, no };
  detailHist = { key: noteKey(pn, machine, no), rows: null };
  renderSheet();
  refreshItem(pn, machine, no).then(() => { if (sheetSel && noteKey(sheetSel.pn, sheetSel.machine, sheetSel.no) === noteKey(pn, machine, no)) renderSheet(); });
  loadDetailHistory(pn, machine, no);
}

function closeDetail() { flushDetailMemo().then(() => { sheetSel = null; renderSheet(); }); }

async function loadDetailHistory(pn, machine, no) {
  const key = noteKey(pn, machine, no);
  const { data, error } = await sb.from('denki_history').select('meeting_date, base, cur, changed')
    .eq('project_number', pn).eq('machine', machine).eq('process_no', no).order('meeting_date', { ascending: false });
  if (!sheetSel || noteKey(sheetSel.pn, sheetSel.machine, sheetSel.no) !== key) return;
  detailHist = { key, rows: error ? [] : data };
  renderDetail(true);
}

// 選んだ項目だけ DB から読み直す（ほかの人の変更を見る・上書きを防ぐ）
async function refreshItem(pn, machine, no) {
  const m = q => q.eq('project_number', pn).eq('machine', machine).eq('process_no', no).maybeSingle();
  const [s, i, me] = await Promise.all([
    no ? m(sb.from('denki_process_status').select('status, start_date, end_date, updated_at')) : Promise.resolve({ data: null }),
    m(sb.from('denki_item_info').select('ball, due_date, steps, updated_at')),
    m(sb.from('denki_item_memos').select('body, updated_at')),
  ]);
  const key = noteKey(pn, machine, no);
  if (no) { if (s.data) statusMap[`${pn}__${machine}__${no}`] = s.data; else delete statusMap[`${pn}__${machine}__${no}`]; }
  if (i.data) itemInfo[key] = i.data; else delete itemInfo[key];
  if (me.data) itemMemos[key] = me.data; else delete itemMemos[key];
}

function renderDetail(force) {
  const box = document.getElementById('sheet-detail');
  if (!sheetSel) { box.hidden = true; box.innerHTML = ''; return; }
  // メモを入力中は描き直さない（入力が消えないように）
  if (!force && box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  if (force && box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') { renderHistoryOnly(); return; }
  box.hidden = false;
  box.innerHTML = '';
  const { pn, machine, no } = sheetSel;
  const ro = !canEdit;

  const head = el('div', 'dt-head');
  head.appendChild(el('span', 'dt-sub', `${pn}　${machine}`));
  const close = el('button', 'dt-close', '✕');
  close.type = 'button'; close.title = '閉じる';
  close.addEventListener('click', closeDetail);
  head.appendChild(close);
  box.appendChild(head);

  const body = el('div', 'dt-body');
  box.appendChild(body);

  // 項目名と前後の項目
  const ttl = el('div', 'dt-item');
  const nm = el('div', 'dt-name');
  if (no) nm.appendChild(el('span', 'dt-no', String(no)));
  nm.appendChild(el('b', '', procName(no)));
  ttl.appendChild(nm);
  if (no && PROCESS_FLOW[no]) ttl.appendChild(el('span', 'dt-flow', PROCESS_FLOW[no]));
  if (no) {
    const nav = el('div', 'dt-nav');
    const mk = (label, to) => {
      const b = el('button', 'dt-navbtn', label);
      b.type = 'button';
      b.disabled = to < 1 || to > PROCESSES.length;
      b.addEventListener('click', () => selectCell(pn, machine, to));
      nav.appendChild(b);
    };
    mk('‹ 前の項目', no - 1); mk('次の項目 ›', no + 1);
    ttl.appendChild(nav);
  }
  body.appendChild(ttl);

  if (no) {
    const rec = recOf(pn, machine, no), date = dateOf(rec), due = dueOf(rec);
    // 予定日
    const sec = section(body, '予定日');
    const row = el('div', 'dt-daterow');
    const di = el('input', 'dt-date');
    di.type = 'date'; di.value = date; di.disabled = ro;
    di.addEventListener('click', () => { try { di.showPicker(); } catch (_) { /* 対応していないブラウザ */ } });
    di.addEventListener('change', () => saveStatus({ start_date: di.value || null, end_date: di.value || null }));
    row.appendChild(di);
    if (due && date) {
      const n = daysFromToday(date);
      row.appendChild(el('span', 'dt-due ' + due, due === 'late' ? `${-n}日遅れ` : n === 0 ? '今日まで' : `あと${n}日`));
    }
    sec.appendChild(row);
    if (isMissingDate(rec)) sec.appendChild(el('div', 'dt-warn', '予定日を入れてください（対象外以外は必須です）'));

    // 状態
    const sec2 = section(body, '状態');
    const grid = el('div', 'dt-status');
    STATUS_LIST.forEach(s => {
      const b = el('button', `dt-st c-${ST_CLASS[s]}${rec.status === s ? ' on' : ''}`, s);
      b.type = 'button'; b.disabled = ro;
      b.addEventListener('click', () => {
        const next = rec.status === s ? null : s;
        if (next && next !== '対象外' && !date) alert('予定日が入っていません。対象外以外は予定日を必ず入れてください。');
        saveStatus({ status: next });
      });
      grid.appendChild(b);
    });
    sec2.appendChild(grid);
  }

  // 今の状況
  const now = el('div', 'dt-now');
  const nh = el('div', 'dt-nowhead');
  nh.appendChild(el('b', '', no ? '今の状況' : 'その他のメモ（項目以外のこと）'));
  if (no && stepDefs[no]) nh.appendChild(el('span', 'dt-steptext', stepText(pn, machine, no) === 'すべて完了' ? '✓ すべて完了' : stepText(pn, machine, no)));
  now.appendChild(nh);

  if (no && stepDefs[no]) {
    const checks = stepChecks(pn, machine, no);
    const list = el('div', 'dt-steps');
    const next = checks.indexOf(false);
    stepDefs[no].forEach((label, i) => {
      const b = el('button', 'dt-step' + (checks[i] ? ' on' : '') + (i === next ? ' next' : ''));
      b.type = 'button'; b.disabled = ro;
      b.innerHTML = `<span class="dt-check">${checks[i] ? '✓' : ''}</span><span></span>`;
      b.lastChild.textContent = label;
      b.addEventListener('click', () => { const c = [...checks]; c[i] = !c[i]; saveInfo({ steps: c }); });
      list.appendChild(b);
    });
    now.appendChild(list);
  }

  if (no) {
    const inf = infoOf(pn, machine, no);
    const br = el('div', 'dt-ballrow');
    br.appendChild(el('span', 'dt-label', '対応中'));
    const rows = el('div', 'dt-balls');
    BALL_ROWS.forEach(r => {
      const line = el('div', 'dt-ballline');
      r.forEach(v => {
        const b = el('button', 'dt-ball' + (inf.ball === v ? ' on' : ''), v);
        b.type = 'button'; b.disabled = ro;
        b.addEventListener('click', () => saveInfo({ ball: inf.ball === v ? null : v }));
        line.appendChild(b);
      });
      rows.appendChild(line);
    });
    br.appendChild(rows);
    now.appendChild(br);

    const dr = el('div', 'dt-ballrow');
    dr.appendChild(el('span', 'dt-label', '期限'));
    const dd = el('input', 'dt-date');
    dd.type = 'date'; dd.value = inf.due_date || ''; dd.disabled = ro;
    dd.addEventListener('click', () => { try { dd.showPicker(); } catch (_) { /* 対応していないブラウザ */ } });
    dd.addEventListener('change', () => saveInfo({ due_date: dd.value || null }));
    dr.appendChild(dd);
    now.appendChild(dr);
  }

  const mw = el('div', 'dt-memo');
  if (no) mw.appendChild(el('span', 'dt-label', '自由メモ'));
  const ta = el('textarea', 'dt-memo-input');
  ta.value = memoOf(pn, machine, no);
  ta.readOnly = ro;
  ta.dataset.key = noteKey(pn, machine, no);
  ta.addEventListener('blur', () => saveMemoFrom(ta));
  mw.appendChild(ta);
  now.appendChild(mw);
  now.appendChild(el('div', 'dt-note', ro ? '見るだけの権限です（編集はできません）'
    : meetingActive() ? `会議中：変更は ${md(meetingToday.meeting_date)} の議事録に自動で記録されます`
    : '会議中ではないので、変更は議事録に記録されません'));
  body.appendChild(now);

  const hs = el('div', 'dt-hist');
  hs.id = 'dt-hist';
  body.appendChild(hs);
  renderHistoryOnly();
}

function section(parent, label) {
  const s = el('div', 'dt-sec');
  s.appendChild(el('span', 'dt-label', label));
  parent.appendChild(s);
  return s;
}

function renderHistoryOnly() {
  const hs = document.getElementById('dt-hist');
  if (!hs) return;
  hs.innerHTML = '';
  hs.appendChild(el('b', 'dt-hist-title', '会議ごとの履歴'));
  const rows = detailHist.rows;
  if (rows === null) { hs.appendChild(el('span', 'dt-muted', '読み込み中…')); return; }
  if (!rows.length) { hs.appendChild(el('span', 'dt-muted', 'まだ記録はありません')); return; }
  rows.forEach(r => {
    const it = el('div', 'dt-hrow');
    it.appendChild(el('b', 'dt-hdate', fmtMeetingDate(r.meeting_date)));
    (r.changed || []).forEach(f => it.appendChild(el('span', 'dt-hline', `${SNAP_LABELS[f]}：${histValue(f, r.base[f])} → ${histValue(f, r.cur[f])}`)));
    hs.appendChild(it);
  });
}
function histValue(f, v) {
  if (!v) return '（なし）';
  if (f === 'sched' || f === 'due') return md(v);
  return v;
}

// ─── 保存 ─────────────────────────────────────────────
let savingCount = 0;
function isSaving() { return savingCount > 0; }
function setSaveStatus(state) {
  const e = document.getElementById('save-status');
  if (!e) return;
  const d = new Date();
  e.textContent = { saving: '… 保存中', saved: `✓ 保存しました ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, error: '× 保存できませんでした' }[state] || '';
  e.dataset.state = state;
}

function sameTime(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

// 保存の前に、ほかの人が先に更新していないか確かめる
async function guardedWrite(table, match, row, cachedAt, del) {
  let q = sb.from(table).select('updated_at');
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const cur = await q.maybeSingle();
  if (cur.error) throw cur.error;
  if (cur.data && !sameTime(cur.data.updated_at, cachedAt)) {
    const e = new Error('conflict'); e.conflict = true; throw e;
  }
  if (del) {
    if (!cur.data) return null;
    let d = sb.from(table).delete();
    Object.entries(match).forEach(([k, v]) => { d = d.eq(k, v); });
    const res = await d.select('process_no');
    if (res.error) throw res.error;
    if (!res.data.length) throw new Error('権限がないか、ログインが切れています');
    return null;
  }
  const res = await sb.from(table).upsert(
    { ...match, ...row, updated_at: new Date().toISOString(), updated_by: await currentEmail() },
    { onConflict: Object.keys(match).join(',') }).select('updated_at');
  if (res.error) throw res.error;
  if (!res.data.length) throw new Error('権限がないか、ログインが切れています');
  return res.data[0].updated_at;
}

async function runSave(fn) {
  if (!canEdit || !sheetSel) return;
  const { pn, machine, no } = sheetSel;
  const before = snapOf(pn, machine, no);
  savingCount++;
  setSaveStatus('saving');
  try {
    await fn(pn, machine, no);
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
    if (e.conflict) alert('ほかの人が先にこの項目を更新していました。最新の内容を読み込みます。\n内容を確かめてから、もう一度入力してください。');
    else alert(`保存できませんでした。\n${e.message || e}\n\nログインが切れている場合は、ページを再読み込みしてください。`);
    await refreshItem(pn, machine, no);
    savingCount--;
    renderSheet();
    return;
  }
  await recordHistory(pn, machine, no, before);
  savingCount--;
  renderSheet();
}

function saveStatus(patch) {
  return runSave(async (pn, machine, no) => {
    const key = `${pn}__${machine}__${no}`;
    const rec = { status: null, start_date: null, end_date: null, ...(statusMap[key] || {}), ...patch };
    const at = await guardedWrite('denki_process_status', { project_number: pn, machine, process_no: no },
      { status: rec.status || null, start_date: rec.start_date || null, end_date: rec.end_date || null }, (statusMap[key] || {}).updated_at);
    statusMap[key] = { ...rec, updated_at: at };
  });
}

function saveInfo(patch) {
  return runSave(async (pn, machine, no) => {
    const key = noteKey(pn, machine, no);
    const cur = { ball: null, due_date: null, steps: null, ...(itemInfo[key] || {}), ...patch };
    const at = await guardedWrite('denki_item_info', { project_number: pn, machine, process_no: no },
      { ball: cur.ball || null, due_date: cur.due_date || null, steps: cur.steps || null }, (itemInfo[key] || {}).updated_at);
    itemInfo[key] = { ...cur, updated_at: at };
  });
}

let memoSaving = null;
function saveMemoFrom(ta) {
  if (!canEdit || !sheetSel || ta.dataset.key !== noteKey(sheetSel.pn, sheetSel.machine, sheetSel.no)) return Promise.resolve();
  const body = ta.value.replace(/\s+$/, '');
  if (body === memoOf(sheetSel.pn, sheetSel.machine, sheetSel.no)) return Promise.resolve();
  memoSaving = runSave(async (pn, machine, no) => {
    const key = noteKey(pn, machine, no);
    const at = await guardedWrite('denki_item_memos', { project_number: pn, machine, process_no: no },
      { body }, (itemMemos[key] || {}).updated_at, !body);
    if (body) itemMemos[key] = { body, updated_at: at }; else delete itemMemos[key];
  }).finally(() => { memoSaving = null; });
  return memoSaving;
}
// 別のマスへ移る・会議を終える前に、入力中のメモを保存する
async function flushDetailMemo() {
  const ta = document.querySelector('#sheet-detail .dt-memo-input');
  if (ta && document.activeElement === ta) ta.blur();
  if (memoSaving) await memoSaving;
}

// ─── 会議中の自動記録 ─────────────────────────────────
// 会議中に最初に変えたときの内容（base）と今の内容（cur）を比べ、違う欄だけを記録する。
// 元に戻して同じになったら、その項目の記録を消す
async function recordHistory(pn, machine, no, before) {
  if (!meetingActive()) return;
  const d = meetingToday.meeting_date, key = noteKey(pn, machine, no);
  const match = { meeting_date: d, project_number: pn, machine, process_no: no };
  try {
    const ex = await sb.from('denki_history').select('*').match(match).maybeSingle();
    if (ex.error) throw ex.error;
    const base = ex.data ? ex.data.base : before;
    const cur = snapOf(pn, machine, no);
    const changed = SNAP_FIELDS.filter(f => (cur[f] || '') !== (base[f] || ''));
    if (!changed.length) {
      if (ex.data) { const r = await sb.from('denki_history').delete().match(match); if (r.error) throw r.error; }
      delete todayHistory[key];
    } else {
      const row = { ...match, base, cur, changed, updated_at: new Date().toISOString(), updated_by: await currentEmail() };
      const r = await sb.from('denki_history').upsert(row, { onConflict: 'meeting_date,project_number,machine,process_no' });
      if (r.error) throw r.error;
      todayHistory[key] = row;
    }
  } catch (e) {
    alert(`変更は保存しましたが、議事録への記録ができませんでした。\n${e.message || e}`);
  }
  if (sheetSel && noteKey(sheetSel.pn, sheetSel.machine, sheetSel.no) === key) loadDetailHistory(pn, machine, no);
}
