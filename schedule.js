// ─── 標準日程（予定日の自動入力・連動） ─────────────────────
// 基準は盤組開始日（No.20）。盤組開始日が月曜日でなければ、その週の月曜日を基準にして計算する。
// 日数は「○週前」で決めるので、基準が月曜日なら 1〜18 もすべて月曜日になる。
//   1〜13 … 盤組開始の○週前。どれかを手で変えたら、ほかの 1〜13 も同じ日数だけずらす（完了・対象外は除く）
//   14    … 盤組開始の○週前。手では変えられない。1〜13 の連動では動かない
//   15〜18 … 盤組開始の○週前。手で変えられる
//   19・20・22 … 全体工程表の「電気艤装」「盤組立」「試運転」の日付をそのまま使う（電気工程表では変えられない）
//   21    … 試運転開始の○週前。手で変えられる
//   工程表で盤組開始日が変わったら 1〜18、試運転開始日が変わったら 21 を、確認してから同じ日数だけずらす
// 標準日程（○週前）は管理画面の「標準日程の設定」で変える（denki_schedule_rules）。
// 標準日程で予定日を入れるのは、新しく追加した工番・機械だけ（denki_columns.sched_filled_at が空の列）
const SCHED_DEFAULT_WEEKS = {
   1: 41,  2: 39,  3: 36,  4: 34,  5: 30,  6: 30,  7: 32,  8: 30,  9: 24,
  10: 21, 11: 19, 12: 17, 13: 15, 14: 11, 15: 5, 16: 4, 17: 2, 18: 1,
  21: 1,   // 試運転開始の○週前
  ship: 10, // 盤組立のタスクが無いとき、工場出荷日の○週前を盤組開始日とする
};
const SCHED_BANKUMI_NOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]; // 盤組開始が基準
const SCHED_CHAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // どれかを変えたら一緒に動く
const SCHED_TEST_NOS = [21];                                     // 試運転開始が基準
const SCHED_LINK = { 19: '電気艤装', 20: '盤組立', 22: '試運転' }; // 全体工程表の日付（変更不可）
const SCHED_LOCKED = [14, 19, 20, 22];                           // 手では変えられない
const SCHED_MAX_WEEKS = 104;

let schedWeeks = { ...SCHED_DEFAULT_WEEKS }; // 保存されている標準日程（denki_schedule_rules）
let schedRulesReady = false; // denki_schedule_rules を読めたか（SQL 未実行なら false）
let schedColsReady = false;  // denki_columns に sched_* の列があるか（SQL 未実行なら false）
let schedSyncing = false;

function schedDays(key) { return (schedWeeks[key] ?? SCHED_DEFAULT_WEEKS[key]) * 7; }
function addDaysStr(str, n) {
  const d = parseLocalDate(str);
  d.setDate(d.getDate() + n);
  return toDBDate(d);
}
function daysBetween(from, to) { return Math.round((parseLocalDate(to) - parseLocalDate(from)) / 86400000); }
// その週の月曜日（日曜日は前の月曜日の週とみなす）
function mondayOf(str) {
  const d = parseLocalDate(str);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return toDBDate(d);
}
function shiftText(days) { return days > 0 ? `${days}日後ろへ` : `${-days}日前へ`; }
function isSkipStatus(st) { return st === '完了' || st === '対象外'; }

// 全体工程表のタスクのうち、条件に合うものの一番早い開始日（現地のタスクは除く）
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
  if (!bankumi) {
    const ship = tasks.filter(t => String(t.text || '').trim() === '工場出荷').map(t => t.end_date || t.start_date || '').filter(Boolean).sort()[0] || '';
    if (ship) bankumi = mondayOf(addDaysStr(ship, -schedDays('ship')));
  }
  return { bankumi, gisou, test, 19: gisou, 20: bankumi, 22: test };
}

// 機械（列）ごとの標準日程（項目番号 → 日付。決まらないものは ''）
function standardDates(links) {
  const base = links.bankumi ? mondayOf(links.bankumi) : '';
  const dates = {};
  SCHED_BANKUMI_NOS.forEach(no => { dates[no] = base ? addDaysStr(base, -schedDays(no)) : ''; });
  SCHED_TEST_NOS.forEach(no => { dates[no] = links.test ? addDaysStr(links.test, -schedDays(no)) : ''; });
  Object.keys(SCHED_LINK).forEach(no => { dates[no] = links[no] || ''; });
  return dates;
}

// 詳細パネルで、予定日を手で変えられない項目の説明（変えられる項目は ''）
function lockedDateNote(no) {
  if (SCHED_LINK[no]) return `全体工程表の「${SCHED_LINK[no]}」の日付です（ここでは変えられません）`;
  if (no === 14) return '盤組開始日から決まる日付です（ここでは変えられません）';
  return '';
}

// ─── 予定日の保存（まとめて） ────────────────────────────
// 状態はそのまま、予定日だけを書き換える。会議中なら議事録にも記録する
async function writeDates(pn, machine, changes) {
  if (!changes.length) return;
  const before = {};
  changes.forEach(c => { before[c.no] = snapOf(pn, machine, c.no); });
  const now = new Date().toISOString(), email = await currentEmail();
  const rows = changes.map(c => ({ project_number: pn, machine, process_no: c.no,
    status: recOf(pn, machine, c.no).status || null, start_date: c.date, end_date: c.date, updated_at: now, updated_by: email }));
  const res = await sb.from('denki_process_status').upsert(rows, { onConflict: 'project_number,machine,process_no' }).select('process_no');
  if (res.error) throw res.error;
  if (!res.data.length) throw new Error('権限がないか、ログインが切れています');
  rows.forEach(r => { statusMap[`${pn}__${machine}__${r.process_no}`] = { status: r.status, start_date: r.start_date, end_date: r.end_date, updated_at: now }; });
  for (const c of changes) await recordHistory(pn, machine, c.no, before[c.no]);
}

// ほかの人と同時に反映しないように、denki_columns の値が前のままのときだけ書き換える（書き換えられたら true）
async function claimColumn(col, patch, field, oldValue) {
  let q = sb.from('denki_columns').update(patch).eq('project_number', col.project_number).eq('machine', col.machine);
  q = oldValue == null ? q.is(field, null) : q.eq(field, oldValue);
  const res = await q.select('machine');
  if (res.error) throw res.error;
  if (!res.data.length) return false;
  Object.assign(col, patch);
  allColumns.filter(c => c.project_number === col.project_number && c.machine === col.machine).forEach(c => Object.assign(c, patch));
  return true;
}

// ─── 読み込みのたびに行うこと（編集できる人だけ） ────────────
//   ① 19・20・22 を全体工程表の日付にそろえる
//   ② 新しく追加した機械に、標準日程で予定日を入れる（空欄だけ）
//   ③ 工程表で盤組開始日・試運転開始日が変わっていたら、確認してからずらす
async function syncSchedules() {
  if (!canEdit || schedSyncing) return false;
  schedSyncing = true;
  let changed = false;
  try {
    for (const col of currentProjects) {
      const pn = col.project_number, machine = col.machine, links = scheduleLinks(col);
      const label = `${pn} ${col.unit ? `${col.link_machine} ${col.unit}` : machine}`;

      // ① 工程表の日付にそろえる
      const linkCh = Object.keys(SCHED_LINK).map(Number)
        .filter(no => { const r = recOf(pn, machine, no); return links[no] && r.status !== '対象外' && dateOf(r) !== links[no]; })
        .map(no => ({ no, date: links[no] }));
      if (linkCh.length) { await writeDates(pn, machine, linkCh); changed = true; }

      if (!schedColsReady) continue;

      // ② 新しく追加した機械（盤組開始日がわかってから入れる）
      if (!col.sched_filled_at) {
        if (!links.bankumi) continue;
        const ok = await claimColumn(col, { sched_filled_at: new Date().toISOString(), sched_bankumi: links.bankumi, sched_test: links.test || null }, 'sched_filled_at', null);
        if (!ok) continue;
        const std = standardDates(links);
        const fill = PROCESSES.map(p => p.no).filter(no => {
          const rec = recOf(pn, machine, no);
          return std[no] && !dateOf(rec) && rec.status !== '対象外';
        }).map(no => ({ no, date: std[no] }));
        await writeDates(pn, machine, fill);
        changed = true;
        continue;
      }

      // ③ 盤組開始日（月曜日にそろえて比べる）・試運転開始日の変更
      changed = (await followBase(col, label, 'sched_bankumi', links.bankumi, '盤組開始日', SCHED_BANKUMI_NOS, true)) || changed;
      changed = (await followBase(col, label, 'sched_test', links.test, '試運転開始日', SCHED_TEST_NOS, false)) || changed;
    }
  } catch (e) {
    console.error(e);
    alert('予定日の自動反映ができませんでした。ページを再読み込みしてください。\n' + (e.message || e));
  } finally {
    schedSyncing = false;
  }
  return changed;
}

async function followBase(col, label, field, now, name, nos, byMonday) {
  const old = col[field] || null;
  if (!now || old === now) return false;
  if (!old) return claimColumn(col, { [field]: now }, field, null); // 初めて覚えるときはずらさない
  const days = byMonday ? daysBetween(mondayOf(old), mondayOf(now)) : daysBetween(old, now);
  const pn = col.project_number, machine = col.machine;
  const targets = nos.filter(no => { const r = recOf(pn, machine, no); return !isSkipStatus(r.status) && dateOf(r); });
  if (!days || !targets.length) return claimColumn(col, { [field]: now }, field, old);
  const ok = confirm(`工程表で ${label} の${name}が ${ymd(old)} → ${ymd(now)} に変わりました。\n\n` +
    `電気工程表の予定日（No.${targets.join('・')}）を ${shiftText(days)} ずらしますか？\n` +
    '（完了・対象外の項目は動かしません。「キャンセル」を押すと、今の予定日のままにします）');
  if (!await claimColumn(col, { [field]: now }, field, old)) return false; // ほかの人が先に反映した
  if (!ok) return false;
  await writeDates(pn, machine, targets.map(no => ({ no, date: addDaysStr(dateOf(recOf(pn, machine, no)), days) })));
  return true;
}

// ─── 詳細パネルで予定日を手で変えたとき ──────────────────────
// 1〜13 のどれかを変えたら、ほかの 1〜13（完了・対象外・日付なしを除く）も同じ日数だけずらす
async function changeItemDate(pn, machine, no, value) {
  const old = dateOf(recOf(pn, machine, no));
  const days = old && value ? daysBetween(old, value) : 0;
  const others = days && SCHED_CHAIN.includes(no)
    ? SCHED_CHAIN.filter(n => { if (n === no) return false; const r = recOf(pn, machine, n); return !isSkipStatus(r.status) && dateOf(r); })
    : [];
  const follow = others.length > 0 && confirm(`ほかの 1〜13 の項目（No.${others.join('・')}）も ${shiftText(days)} ずらしますか？\n` +
    '（完了・対象外の項目は動かしません。「キャンセル」を押すと、この項目だけ変えます）');
  await saveStatus({ start_date: value || null, end_date: value || null });
  if (!follow || dateOf(recOf(pn, machine, no)) !== value) return; // 保存できなかったときはずらさない
  savingCount++;
  setSaveStatus('saving');
  try {
    await writeDates(pn, machine, others.map(n => ({ no: n, date: addDaysStr(dateOf(recOf(pn, machine, n)), days) })));
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
    alert(`この項目は保存しましたが、ほかの項目をずらせませんでした。\n${e.message || e}\n\nページを再読み込みして確かめてください。`);
  }
  savingCount--;
  renderSheet();
}

// ─── 管理画面「標準日程の設定」 ──────────────────────────
// 項目ごとに「○週前」を決める。変えた日数は、これから追加する工番・機械にだけ使う
let ruleDraft = {};
let ruleMsg = '';
const RULE_KEYS = [...SCHED_BANKUMI_NOS, ...SCHED_TEST_NOS, 'ship'];
const ruleChanged = k => String(ruleDraft[k]) !== String(schedWeeks[k]);
const ruleValid = k => /^\d+$/.test(String(ruleDraft[k])) && Number(ruleDraft[k]) <= SCHED_MAX_WEEKS;

function openRules(view) {
  ruleDraft = {};
  RULE_KEYS.forEach(k => { ruleDraft[k] = schedWeeks[k]; });
  ruleMsg = '';
  const bar = el('div', 'am-bar');
  bar.appendChild(el('b', '', '新しく追加する工番・機械に入れる予定日の決まり'));
  bar.appendChild(el('span', 'am-hint', '変えた日数は、これから追加する工番・機械にだけ使います。今ある工番・機械の予定日は変わりません。'));
  view.appendChild(bar);
  if (!schedRulesReady) view.appendChild(el('div', 'am-warn pl-sqlwarn', 'データベースの準備（SQL の実行）がまだのため、保存できません。今は最初の決まりで表示しています。'));

  const card = el('div', 'am-card pl-card');
  const wrap = el('div', 'pl-wrap');
  const tbl = el('table', 'pl-table');
  const hr = el('tr');
  ['No', '項目', '基準', '何週前', '', '動き方'].forEach(t => hr.appendChild(el('th', '', t)));
  const thead = el('thead'); thead.appendChild(hr); tbl.appendChild(thead);
  const tbody = el('tbody');
  const foot = el('div', 'am-foot');
  const days = {};

  const weekCell = (k, tr) => {
    const td = el('td', 'wk');
    const inp = el('input', 'pl-week');
    inp.type = 'number'; inp.min = '0'; inp.max = String(SCHED_MAX_WEEKS); inp.step = '1';
    inp.value = ruleDraft[k];
    inp.addEventListener('input', () => { ruleDraft[k] = inp.value.trim(); rulesUpdated(); });
    td.appendChild(inp);
    td.appendChild(el('span', 'u', '週前'));
    tr.appendChild(td);
    days[k] = el('td', 'days');
    tr.appendChild(days[k]);
  };
  const row = (no, name, base, k, how) => {
    const tr = el('tr', k ? '' : 'skip');
    tr.appendChild(el('td', 'no', no));
    tr.appendChild(el('td', 'nm', name));
    tr.appendChild(el('td', 'base', base));
    if (k) weekCell(k, tr); else { tr.appendChild(el('td', 'wk', '—')); tr.appendChild(el('td', 'days', '')); }
    tr.appendChild(el('td', 'rule', how));
    tbody.appendChild(tr);
  };
  PROCESSES.forEach(p => {
    const no = p.no;
    if (SCHED_LINK[no]) row(String(no), p.name, `工程表の「${SCHED_LINK[no]}」`, null, '工程表の日付をそのまま使う（変更不可）');
    else if (SCHED_TEST_NOS.includes(no)) row(String(no), p.name, '試運転開始', no, '手で変えられる。試運転開始日が変わったら確認してずらす');
    else if (no === 14) row(String(no), p.name, '盤組開始', no, '手では変えられない。盤組開始日が変わったら動く');
    else if (SCHED_CHAIN.includes(no)) row(String(no), p.name, '盤組開始', no, '1〜13 のどれかを変えたら一緒に動く');
    else row(String(no), p.name, '盤組開始', no, '手で変えられる。盤組開始日が変わったら確認してずらす');
  });
  row('—', '盤組立のタスクが無いときの盤組開始日', '工場出荷', 'ship', 'この日の週の月曜日を盤組開始日とする');
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  card.appendChild(wrap);
  view.appendChild(card);
  view.appendChild(foot);

  function rulesUpdated() {
    ruleMsg = '';
    adminDirty = RULE_KEYS.some(ruleChanged);
    RULE_KEYS.forEach(k => {
      const ok = ruleValid(k);
      days[k].textContent = ok ? `＝ ${Number(ruleDraft[k]) * 7}日前` : `0〜${SCHED_MAX_WEEKS}の数字で入れてください`;
      days[k].className = 'days' + (ok ? '' : ' bad') + (ruleChanged(k) ? ' chg' : '');
    });
    renderFoot();
  }
  function renderFoot() {
    foot.innerHTML = '';
    const changed = RULE_KEYS.filter(ruleChanged);
    foot.appendChild(el('span', 'msg' + (ruleMsg ? ' ok' : changed.length ? ' dirty' : ''),
      ruleMsg || (changed.length ? `保存していない変更：${changed.length}項目` : '変更はありません')));
    const reset = amBtn('am-btn', '元に戻す', () => openAdmin2Reset());
    const save = amBtn('am-btn dark', '保存', () => saveRules(save));
    reset.disabled = !changed.length;
    save.disabled = !changed.length || !schedRulesReady || !RULE_KEYS.every(ruleValid);
    foot.appendChild(reset);
    foot.appendChild(save);
  }
  function openAdmin2Reset() {
    adminDirty = false;
    view.innerHTML = '';
    openRules(view);
  }
  async function saveRules(btn) {
    btn.disabled = true;
    const email = await currentEmail(), now = new Date().toISOString();
    const rows = RULE_KEYS.filter(ruleChanged).map(k => ({ rule_key: String(k), weeks: Number(ruleDraft[k]), updated_at: now, updated_by: email }));
    const res = await sb.from('denki_schedule_rules').upsert(rows, { onConflict: 'rule_key' }).select('rule_key');
    if (res.error || !res.data.length) {
      btn.disabled = false;
      alert('保存できませんでした。\n' + (res.error ? res.error.message : '権限がないか、ログインが切れています'));
      return;
    }
    rows.forEach(r => { schedWeeks[r.rule_key === 'ship' ? 'ship' : Number(r.rule_key)] = r.weeks; });
    adminDirty = false;
    ruleMsg = '保存しました';
    rulesUpdated();
  }
  rulesUpdated();
}

// 読み込んだ denki_schedule_rules を反映する
function applyScheduleRules(rows) {
  schedWeeks = { ...SCHED_DEFAULT_WEEKS };
  (rows || []).forEach(r => {
    const k = r.rule_key === 'ship' ? 'ship' : Number(r.rule_key);
    if (k in SCHED_DEFAULT_WEEKS && Number.isFinite(r.weeks)) schedWeeks[k] = r.weeks;
  });
}
