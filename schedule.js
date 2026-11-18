// ─── 標準日程（予定日の自動入力・連動の決まり） ─────────────
// 基準は盤組開始日（No.20）。盤組開始日が月曜日でなければ、その週の月曜日を基準にして計算する。
// 日数はすべて7の倍数なので、基準が月曜日なら 1〜18 もすべて月曜日になる。
//   1〜13 … 盤組開始の N日前。どれかを変えたら、前後の項目も同じ日数だけずらす（完了・対象外は除く）
//   14    … 常に盤組開始の77日前（手で変えられない）
//   15〜18 … 盤組開始の N日前。盤組開始が変わったら、確認してから同じ日数だけずらす
//   19・20・22 … 全体工程表の日付をそのまま使う（電気工程表では変えられない）
//   21    … 試運転開始の7日前
// 今は「標準日程の試算」（管理画面）で計算結果を見せるだけで、保存はしない
const SCHED_DAYS_BEFORE_BANKUMI = {
   1: 287,  2: 273,  3: 252,  4: 238,  5: 210,  6: 210,  7: 224,  8: 210,  9: 168,
  10: 147, 11: 133, 12: 119, 13: 105, 14: 77, 15: 35, 16: 28, 17: 14, 18: 7,
};
const SCHED_CHAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // どれかを変えたら一緒に動く
const SCHED_FIXED = [14];                                         // 常に盤組開始の77日前
const SCHED_DAYS_BEFORE_TEST = { 21: 7 };                         // 試運転開始の N日前
const SCHED_LINK_NOS = [19, 20, 22];                              // 全体工程表の日付（変更不可）
const SHIP_TO_BANKUMI_DAYS = 70; // 盤組立のタスクが無いときは、工場出荷日の70日前を盤組開始日とする

function addDaysStr(str, n) {
  const d = parseLocalDate(str);
  d.setDate(d.getDate() + n);
  return toDBDate(d);
}
// その週の月曜日（日曜日は前の月曜日の週とみなす）
function mondayOf(str) {
  const d = parseLocalDate(str);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return toDBDate(d);
}
function isMonday(str) { return parseLocalDate(str).getDay() === 1; }

// 全体工程表のタスクのうち、条件に合うものの一番早い開始日
function earliestTaskStart(tasks, pred) {
  let best = '';
  tasks.forEach(t => {
    const text = String(t.text || '').trim();
    if (text.startsWith('現地') || !pred(text)) return;
    const d = t.start_date || t.end_date || '';
    if (d && (!best || d < best)) best = d;
  });
  return best;
}

// 機械（列）ごとに、全体工程表から盤組開始・電気艤装開始・試運転開始の日付を拾う
function scheduleLinks(col) {
  const tasks = colTasks[`${col.project_number}__${col.machine}`] || [];
  const gisou = earliestTaskStart(tasks, s => s.includes('電気艤装'));
  const test = earliestTaskStart(tasks, s => s === '試運転' || s === '社内試運転');
  let bankumi = earliestTaskStart(tasks, s => s.includes('盤組立') || s === '盤組');
  let bankumiSrc = bankumi ? '工程表の「盤組立」' : '';
  if (!bankumi) {
    const ship = tasks.filter(t => String(t.text || '').trim() === '工場出荷').map(t => t.end_date || t.start_date || '').filter(Boolean).sort()[0] || '';
    if (ship) {
      bankumi = mondayOf(addDaysStr(ship, -SHIP_TO_BANKUMI_DAYS));
      bankumiSrc = `工場出荷（${fmtMD(ship)}）の${SHIP_TO_BANKUMI_DAYS}日前の週の月曜日`;
    }
  }
  return { bankumi, bankumiSrc, gisou, test };
}

// 機械（列）ごとの標準日程。dates は 項目番号 → 日付（決まらないものは ''）
function standardSchedule(col) {
  const links = scheduleLinks(col);
  const base = links.bankumi ? mondayOf(links.bankumi) : '';
  const dates = {};
  PROCESSES.forEach(p => {
    const no = p.no;
    if (SCHED_DAYS_BEFORE_BANKUMI[no] !== undefined) dates[no] = base ? addDaysStr(base, -SCHED_DAYS_BEFORE_BANKUMI[no]) : '';
    else if (SCHED_DAYS_BEFORE_TEST[no] !== undefined) dates[no] = links.test ? addDaysStr(links.test, -SCHED_DAYS_BEFORE_TEST[no]) : '';
    else if (no === 19) dates[no] = links.gisou;
    else if (no === 20) dates[no] = links.bankumi;
    else if (no === 22) dates[no] = links.test;
    else dates[no] = '';
  });
  return { links, base, dates };
}

// 項目の決まりの説明（試算画面の「決まり」欄）
function scheduleRuleText(no) {
  if (SCHED_CHAIN.includes(no)) return `盤組開始の${SCHED_DAYS_BEFORE_BANKUMI[no]}日前（1〜13連動）`;
  if (SCHED_FIXED.includes(no)) return `常に盤組開始の${SCHED_DAYS_BEFORE_BANKUMI[no]}日前`;
  if (SCHED_DAYS_BEFORE_BANKUMI[no] !== undefined) return `盤組開始の${SCHED_DAYS_BEFORE_BANKUMI[no]}日前`;
  if (SCHED_DAYS_BEFORE_TEST[no] !== undefined) return `試運転開始の${SCHED_DAYS_BEFORE_TEST[no]}日前`;
  if (no === 19) return '工程表の「電気艤装」（変更不可）';
  if (no === 20) return '工程表の「盤組立」（変更不可）';
  if (no === 22) return '工程表の「試運転」（変更不可）';
  return '';
}

// ─── 管理画面「標準日程の試算」 ──────────────────────────
// 左で機械を選び、右に項目ごとの「今の予定日」と「標準日程」を並べる。見るだけで保存はしない
let planSel = null; // 選んでいる列 `${工番}__${機械}`

function planDiffCount(col) {
  const std = standardSchedule(col);
  return PROCESSES.filter(p => {
    const rec = recOf(col.project_number, col.machine, p.no);
    if (rec.status === '対象外' || rec.status === '完了') return false;
    return (std.dates[p.no] || '') !== dateOf(rec);
  }).length;
}

function openPlan(view) {
  const bar = el('div', 'am-bar');
  bar.appendChild(el('b', '', '標準日程の試算（見るだけ・保存しません）'));
  bar.appendChild(el('span', 'am-hint', '盤組開始日（月曜日でなければその週の月曜日）を基準に計算した日付と、今入っている予定日を並べます。今の予定日は変わりません。'));
  view.appendChild(bar);
  if (!currentProjects.length) { view.appendChild(el('div', 'am-muted', '表示する工番がありません。')); return; }
  const keyOf = c => `${c.project_number}__${c.machine}`;
  if (!currentProjects.some(c => keyOf(c) === planSel)) planSel = keyOf(currentProjects[0]);

  const split = el('div', 'am-split');
  const left = el('div', 'am-card');
  const lhead = el('div', 'am-cardhead');
  lhead.appendChild(el('b', '', '機械'));
  lhead.appendChild(el('span', '', '数字は標準日程と違う項目の数（完了・対象外を除く）'));
  left.appendChild(lhead);
  const items = el('div', 'am-items');
  left.appendChild(items);
  const right = el('div', 'am-card');
  split.appendChild(left);
  split.appendChild(right);
  view.appendChild(split);

  const renderLeft = () => {
    const top = items.scrollTop;
    items.innerHTML = '';
    currentProjects.forEach(c => {
      const b = amBtn('am-item pn' + (keyOf(c) === planSel ? ' on' : ''), null, () => { planSel = keyOf(c); renderLeft(); renderPlanDetail(right, c); });
      b.appendChild(el('b', '', c.project_number));
      b.appendChild(el('span', 'nm', c.machine + (c.unit ? `（${c.unit}）` : '')));
      const n = planDiffCount(c);
      const meta = el('span', 'meta');
      meta.appendChild(el('span', 'am-badge' + (n ? '' : ' none'), n ? String(n) : '—'));
      b.appendChild(meta);
      items.appendChild(b);
    });
    items.scrollTop = top;
  };
  renderLeft();
  renderPlanDetail(right, currentProjects.find(c => keyOf(c) === planSel));
}

function renderPlanDetail(right, col) {
  right.innerHTML = '';
  const std = standardSchedule(col);
  const head = el('div', 'am-edhead');
  head.appendChild(el('b', 'no', col.project_number));
  head.appendChild(el('b', 'nm', col.machine + (col.unit ? `（${col.unit}）` : '')));
  right.appendChild(head);

  const info = el('div', 'pl-info');
  const L = std.links;
  if (!L.bankumi) {
    info.appendChild(el('div', 'am-warn', '全体工程表に「盤組立」も「工場出荷」も日付が無いため、盤組開始日が決まらず 1〜18 は計算できません。'));
  } else {
    const line = el('div', 'pl-base');
    line.appendChild(el('span', 'am-label', '盤組開始日'));
    line.appendChild(el('b', '', `${ymd(L.bankumi)}（${'日月火水木金土'[parseLocalDate(L.bankumi).getDay()]}）`));
    line.appendChild(el('span', 'am-hint', L.bankumiSrc));
    info.appendChild(line);
    if (!isMonday(L.bankumi)) {
      info.appendChild(el('div', 'am-warn', `盤組開始日が月曜日ではないため、その週の月曜日 ${ymd(std.base)} を基準に計算しています。`));
    }
  }
  if (!L.test) info.appendChild(el('div', 'am-warn', '全体工程表に「試運転」の日付が無いため、21・22 は計算できません。'));
  right.appendChild(info);

  const wrap = el('div', 'pl-wrap');
  const tbl = el('table', 'pl-table');
  const thead = el('thead');
  const hr = el('tr');
  ['No', '項目', '状態', '今の予定日', '標準日程', '標準日程にすると', '決まり'].forEach(t => hr.appendChild(el('th', '', t)));
  thead.appendChild(hr);
  tbl.appendChild(thead);
  const tbody = el('tbody');
  PROCESSES.forEach(p => {
    const rec = recOf(col.project_number, col.machine, p.no);
    const cur = dateOf(rec), s = std.dates[p.no] || '';
    const st = rec.status || '';
    const skip = st === '対象外' || st === '完了';
    const tr = el('tr', skip ? 'skip' : '');
    tr.appendChild(el('td', 'no', String(p.no)));
    tr.appendChild(el('td', 'nm', p.name));
    tr.appendChild(el('td', 'st', st || '—'));
    tr.appendChild(el('td', 'd', cur ? ymd(cur) : '—'));
    tr.appendChild(el('td', 'd std', st === '対象外' ? '日付なし' : s ? ymd(s) : '—'));
    let diff = '', cls = 'diff';
    if (st === '対象外') diff = '';
    else if (st === '完了') diff = '完了のため変えない';
    else if (!s) diff = '';
    else if (!cur) { diff = '新しく入る'; cls += ' new'; }
    else {
      const n = Math.round((parseLocalDate(s) - parseLocalDate(cur)) / 86400000);
      if (n === 0) diff = '同じ';
      else { diff = n > 0 ? `${n}日後ろへ` : `${-n}日前へ`; cls += ' chg'; }
    }
    tr.appendChild(el('td', cls, diff));
    tr.appendChild(el('td', 'rule', scheduleRuleText(p.no)));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  right.appendChild(wrap);
}
