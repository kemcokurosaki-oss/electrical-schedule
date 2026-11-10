// ─── 進捗確認表（メイン画面） ─────────────────────────────
// Excel「電気工程確認会議」と同じ形の表。行が項目（config.js の PROCESSES）、列が工番の機械。
// 機械ごとに「予定日・状態」と「メモ」の2列。
//   予定日・状態 … 今の状態だけを持つ（denki_process_status。予定日は start_date・end_date に同じ日付を入れる）
//   メモ       … 今の内容（denki_item_memos の 工番＋機械＋項目。項目 0 は機械ごとの「その他」）。文字だけ。
//                上の「議事録を作成」を押すと、そのときのメモから議事録を作る（前回との違いを赤・青で表示。minutes.js）
let itemMemos = {};     // noteKey → メモの文章（app.js の loadData で読む）
let sheetPns = null;    // 表示する工番（null はすべて）
let sheetMemo = true;   // メモの列を表示するか
try {
  const s = JSON.parse(localStorage.getItem('denki_sheet_pns'));
  sheetPns = Array.isArray(s) && s.length ? new Set(s) : null;
  sheetMemo = localStorage.getItem('denki_sheet_memo') !== '0';
} catch (_) { /* 読めなければ最初の状態 */ }

const SHEET_OTHER_NO = 0; // 機械ごとの「その他」欄の項目番号

function noteKey(pn, machine, no) {
  return `${pn}|${machine || ''}|${no || 0}`;
}

function sheetGroups() {
  const groups = [];
  currentProjects.forEach(p => {
    if (sheetPns && !sheetPns.has(p.project_number)) return;
    const last = groups[groups.length - 1];
    if (last && last.pn === p.project_number) last.cols.push(p);
    else groups.push({ pn: p.project_number, customer: p.customer_name, cols: [p] });
  });
  return groups;
}

// 工場出荷の日（全体工程表のタスク「工場出荷」）
function shipDateOf(proj) {
  const t = (ganttTasks[`${proj.project_number}__${proj.machine}`] || []).find(x => String(x.text || '').trim() === '工場出荷');
  return t ? (t.end_date || t.start_date || '') : '';
}

// 予定日の色: 完了・対象外以外で、過ぎていれば遅れ、WARN_DAYS 日以内なら注意
function dueClass(rec) {
  const d = rec && (rec.end_date || rec.start_date);
  if (!d || rec.status === '完了' || rec.status === '対象外') return '';
  const days = Math.round((parseLocalDate(d) - todayStart()) / 86400000);
  return days < 0 ? 'due-late' : days <= WARN_DAYS ? 'due-soon' : '';
}

let sheetRenderSeq = 0;
async function renderSheet() {
  const seq = ++sheetRenderSeq;
  renderSheetTools();
  const wrap = document.getElementById('sheet-wrap');
  if (currentProjects.length === 0) {
    wrap.innerHTML = '<div class="no-data">表示する列がありません。左メニューの「工番管理」から工番と機械を追加してください。</div>';
    return;
  }
  if (seq !== sheetRenderSeq) return;
  const scroll = { left: wrap.scrollLeft, top: wrap.scrollTop };
  wrap.innerHTML = '';
  wrap.appendChild(buildSheetTable());
  wrap.querySelectorAll('.sh-memo-input').forEach(fitMemoHeight);
  fixSheetSticky(wrap);
  wrap.scrollLeft = scroll.left; wrap.scrollTop = scroll.top;
}

// 左に固定する No.・項目・流れの位置は、実際の列の幅から決める（幅がずれて No. が隠れないように）
function fixSheetSticky(wrap) {
  const head = wrap.querySelector('thead tr');
  if (!head) return;
  let left = 0;
  ['sh-no', 'sh-name', 'sh-flow'].forEach(cls => {
    const th = head.querySelector('.' + cls);
    wrap.querySelectorAll('.' + cls).forEach(el => { el.style.left = left + 'px'; });
    left += th.getBoundingClientRect().width;
  });
}

function buildSheetTable() {
  const groups = sheetGroups();
  const span = sheetMemo ? 2 : 1;
  const table = document.createElement('table');
  table.className = 'sh-table' + (sheetMemo ? '' : ' no-memo');
  const thead = document.createElement('thead');
  const r1 = document.createElement('tr'), r2 = document.createElement('tr'), r3 = document.createElement('tr');
  r1.className = 'sh-h1'; r2.className = 'sh-h2'; r3.className = 'sh-h3';
  const fixed = (text, cls) => {
    const th = document.createElement('th');
    th.rowSpan = 3; th.className = cls; th.textContent = text;
    r1.appendChild(th);
  };
  fixed('No.', 'sh-no'); fixed('項目', 'sh-name'); fixed('流れ', 'sh-flow');
  groups.forEach((g, gi) => {
    const th = document.createElement('th');
    th.colSpan = g.cols.length * span;
    th.className = 'sh-pn' + (gi ? ' sh-gap' : '');
    th.dataset.pn = g.pn;
    th.innerHTML = '<b></b><span></span>';
    th.firstChild.textContent = g.pn;
    th.lastChild.textContent = g.customer || '';
    r1.appendChild(th);
    g.cols.forEach((c, ci) => {
      const gap = gi && !ci ? ' sh-gap' : '';
      const m = document.createElement('th');
      m.colSpan = span;
      m.className = 'sh-machine' + gap;
      const pr = progressOf(c);
      m.innerHTML = '<span class="sh-mname"></span><span class="sh-mprog"></span>';
      m.firstChild.textContent = c.machine || '(機種なし)';
      m.lastChild.textContent = `${pr.done}/${pr.total}`;
      m.lastChild.dataset.col = `${c.project_number}__${c.machine}`;
      m.title = `${g.pn} ${c.machine}　対象外を除く ${pr.total} 項目のうち ${pr.done} 項目が完了`;
      r2.appendChild(m);
      const a = document.createElement('th');
      a.className = 'sh-sub sh-ds-h' + gap;
      a.textContent = '予定日・状態';
      r3.appendChild(a);
      if (sheetMemo) {
        const b = document.createElement('th');
        b.className = 'sh-sub sh-memo-h';
        const w = memoColWidth(c);
        b.style.width = b.style.minWidth = b.style.maxWidth = w + 'px';
        b.textContent = 'メモ';
        r3.appendChild(b);
      }
    });
  });
  thead.appendChild(r1); thead.appendChild(r2); thead.appendChild(r3);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const row = (no, name, flow, cls, cellFn) => {
    const tr = document.createElement('tr');
    tr.className = cls;
    const a = document.createElement('td'); a.className = 'sh-no'; a.textContent = no;
    const b = document.createElement('td'); b.className = 'sh-name'; b.textContent = name;
    const c = document.createElement('td'); c.className = 'sh-flow'; c.textContent = flow;
    tr.appendChild(a); tr.appendChild(b); tr.appendChild(c);
    groups.forEach((g, gi) => g.cols.forEach((col, ci) => cellFn(tr, col, gi && !ci ? ' sh-gap' : '')));
    tbody.appendChild(tr);
  };
  PROCESSES.forEach(proc => {
    row(proc.no, proc.name, PROCESS_FLOW[proc.no] || '', 'dept-' + (PROCESS_DEPT[proc.no] || 'other'), (tr, col, gap) => {
      tr.appendChild(sheetStatusCell(col, proc, gap));
      if (sheetMemo) tr.appendChild(sheetMemoCell(col, proc.no));
    });
  });
  // 機械ごとの「その他」（項目に当てはまらない話）
  row('', 'その他', '', 'sh-other', (tr, col, gap) => {
    const td = document.createElement('td');
    td.className = 'sh-ds sh-other-label' + gap;
    td.textContent = sheetMemo ? '項目以外のこと' : '';
    tr.appendChild(td);
    if (sheetMemo) tr.appendChild(sheetMemoCell(col, SHEET_OTHER_NO));
  });
  // 出荷日（全体工程表の「工場出荷」。表示だけ）
  row('', '工場出荷', '', 'sh-ship', (tr, col, gap) => {
    const td = document.createElement('td');
    td.className = 'sh-ds' + gap;
    td.colSpan = span;
    td.textContent = fmtDate(shipDateOf(col)) || '─';
    td.title = '全体工程表の「工場出荷」の日付';
    tr.appendChild(td);
  });
  table.appendChild(tbody);
  return table;
}

// 予定日・状態のマス
function sheetStatusCell(col, proc, gap) {
  const rec = statusMap[procKey(col, proc)] || {};
  const status = rec.status || '';
  const td = document.createElement('td');
  const paint = r => { td.className = `sh-ds st-${getStatusClass(r.status || '')} ${dueClass(r)}${gap}`; };
  paint(rec);
  const date = rec.end_date || rec.start_date || '';
  if (!canEdit) {
    td.innerHTML = '<div class="sh-date"></div>';
    td.firstChild.textContent = fmtDate(date) || '';
    if (status) { // 状態が空のマスは何も出さない
      const pill = document.createElement('span');
      pill.className = 'st-pill';
      pill.textContent = status;
      td.appendChild(pill);
    }
    return td;
  }
  const di = document.createElement('input');
  di.type = 'date';
  di.className = 'sh-date-input';
  di.value = date;
  di.title = '予定日';
  const markEmpty = () => di.classList.toggle('empty', !di.value); // 空の欄の「年/月/日」は薄く
  markEmpty();
  di.addEventListener('input', markEmpty);
  const sel = document.createElement('select');
  sel.className = 'tl-select st-pill';
  ['', ...STATUS_LIST].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v || '─';
    sel.appendChild(o);
  });
  sel.value = status;
  const save = async patch => {
    di.disabled = sel.disabled = true;
    const ok = await saveProcessRec(col, proc, patch);
    di.disabled = sel.disabled = false;
    if (!ok) return;
    paint(statusMap[procKey(col, proc)] || {});
    afterSheetStatusSaved(col);
  };
  di.addEventListener('change', () => save({ start_date: di.value || null, end_date: di.value || null }));
  sel.addEventListener('change', () => save({ status: sel.value || null }));
  td.appendChild(di); td.appendChild(sel);
  return td;
}

// 状態を変えたら、機械の完了数・ガントの「タスク」欄・上部の数をそろえる
function afterSheetStatusSaved(col) {
  const pr = progressOf(col);
  document.querySelectorAll('.sh-mprog').forEach(el => {
    if (el.dataset.col === `${col.project_number}__${col.machine}`) el.textContent = `${pr.done}/${pr.total}`;
  });
  updateGanttProgress(col);
  renderTaskPanel();
}

// メモのマス（文字だけ。入力欄から離れたら今の内容として保存する。議事録には「議事録を作成」を押したときに入る）
// メモの列の幅（px）: その機械のメモで一番長い行の見た目の長さに合わせる（最小 SHEET_MEMO_MIN、最大 SHEET_MEMO_MAX。長い行は折り返す）
const SHEET_MEMO_MIN = 120, SHEET_MEMO_MAX = 420;
function textWidth(line) {
  let w = 0;
  for (const ch of line) w += ch.charCodeAt(0) > 0xff ? 12 : 7; // 12px の文字で全角 12・半角 7 くらい
  return w;
}
function memoColWidth(col) {
  let max = 0;
  [...PROCESSES.map(p => p.no), SHEET_OTHER_NO].forEach(no => {
    String(itemMemos[noteKey(col.project_number, col.machine, no)] || '').split('\n').forEach(l => { max = Math.max(max, textWidth(l)); });
  });
  return Math.max(SHEET_MEMO_MIN, Math.min(SHEET_MEMO_MAX, max + 24));
}

// 入力欄の高さを中身に合わせる（行の高さも一緒に伸びる）
function fitMemoHeight(ta) {
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
}

function sheetMemoCell(col, no) {
  const td = document.createElement('td');
  td.className = 'sh-memo';
  const w = memoColWidth(col);
  td.style.width = td.style.minWidth = td.style.maxWidth = w + 'px';
  const key = noteKey(col.project_number, col.machine, no);
  const body = itemMemos[key] || '';
  if (!canEdit) {
    const v = document.createElement('div');
    v.className = 'sh-memo-view';
    v.textContent = body;
    td.appendChild(v);
    return td;
  }
  const ta = document.createElement('textarea');
  ta.className = 'sh-memo-input';
  ta.value = body;
  ta.rows = 1;
  ta.addEventListener('input', () => { fitMemoHeight(ta); ta.classList.toggle('dirty', ta.value !== (itemMemos[key] || '')); });
  ta.addEventListener('blur', () => {
    if (ta.value === (itemMemos[key] || '')) return;
    const p = saveItemMemo(col, no, ta.value).then(ok => { if (ok) ta.classList.remove('dirty'); });
    pendingMemoSaves.add(p);
    p.finally(() => pendingMemoSaves.delete(p));
  });
  td.appendChild(ta);
  return td;
}

// 入力中のメモを保存し終わるまで待つ（議事録を作る前・表を描き直す前）
const pendingMemoSaves = new Set();
async function flushSheetMemos() {
  if (document.activeElement && document.activeElement.classList.contains('sh-memo-input')) document.activeElement.blur();
  await Promise.all([...pendingMemoSaves]);
}

async function saveItemMemo(col, no, text) {
  const body = String(text || '').replace(/\s+$/, '');
  const key = noteKey(col.project_number, col.machine, no);
  setSheetSaveState('saving');
  try {
    let res;
    if (body) {
      res = await sb.from('denki_item_memos').upsert(
        { project_number: col.project_number, machine: col.machine, process_no: no, body, updated_at: new Date().toISOString(), updated_by: await currentEmail() },
        { onConflict: 'project_number,machine,process_no' }).select('process_no');
    } else {
      res = await sb.from('denki_item_memos').delete()
        .eq('project_number', col.project_number).eq('machine', col.machine).eq('process_no', no).select('process_no');
    }
    if (res.error) throw res.error;
    if (body && !res.data.length) throw new Error('権限がないか、ログインが切れています');
    if (body) itemMemos[key] = body; else delete itemMemos[key];
    setSheetSaveState('saved');
    return true;
  } catch (e) {
    setSheetSaveState('error');
    alert(`メモを保存できませんでした。入力した内容は画面に残っています。\n${e.message || e}\n\nログインが切れている場合は、入力内容を控えてからページを再読み込みしてください。`);
    return false;
  }
}

let sheetSavedAt = null;
function setSheetSaveState(state) {
  if (state === 'saved') sheetSavedAt = new Date();
  const el = document.getElementById('sheet-save-status');
  if (!el) return;
  const hm = sheetSavedAt ? `${sheetSavedAt.getHours()}:${String(sheetSavedAt.getMinutes()).padStart(2, '0')}` : '';
  el.textContent = { saving: '… 保存中', saved: `✓ メモを保存しました ${hm}`, error: '× 保存できませんでした' }[state] || '';
  el.dataset.state = state;
}

// 予定日・状態を保存する（電気工程表だけに保存。全体工程表には書かない）
async function saveProcessRec(col, proc, patch) {
  if (!canEdit) return false;
  const key = procKey(col, proc);
  const rec = { status: null, start_date: null, end_date: null, tantousha: null, memo: null, ...(statusMap[key] || {}), ...patch };
  try {
    const isEmpty = !rec.status && !rec.start_date && !rec.end_date && !rec.tantousha && !rec.memo;
    if (isEmpty) {
      if (statusMap[key]) {
        const { data, error } = await sb.from('denki_process_status').delete()
          .eq('project_number', col.project_number).eq('machine', col.machine).eq('process_no', proc.no)
          .select('process_no');
        if (error) throw error;
        if (!data.length) throw new Error('削除できませんでした（権限がないか、ログインが切れています）');
        delete statusMap[key];
      }
    } else {
      const { data, error } = await sb.from('denki_process_status').upsert(
        { project_number: col.project_number, machine: col.machine, process_no: proc.no, ...rec },
        { onConflict: 'project_number,machine,process_no' }).select('process_no');
      if (error) throw error;
      if (!data.length) throw new Error('保存できませんでした（権限がないか、ログインが切れています）');
      statusMap[key] = rec;
    }
    return true;
  } catch (e) {
    console.warn('保存エラー:', e);
    alert(`保存できませんでした。\n${e.message || e}\n\n画面を保存済みの内容に戻します。ログインが切れている場合は、ページを再読み込みしてください。`);
    await refreshDisplay();
    return false;
  }
}

// ─── 上の操作の行 ─────────────────────────────────────
// 1行目: 議事録を作成（会議の日付）・前回の議事録・メモの保存の状態　2行目: 工番の絞り込み・メモの表示切り替え
function renderSheetTools() {
  const box = document.getElementById('sheet-tools');
  if (!box.dataset.built) {
    box.dataset.built = '1';
    box.innerHTML = `
      <div class="sheet-row">
        <span id="sheet-make"></span>
        <span class="dock-meta" id="sheet-meta"></span>
        <span class="save-status" id="sheet-save-status"></span>
      </div>
      <div class="sheet-row">
        <span class="f-title">工番</span>
        <span class="chip-group" id="sheet-pns"></span>
        <span class="sep"></span>
        <button class="chip" id="sheet-memo-toggle"></button>
      </div>`;
    if (canEdit) document.getElementById('sheet-make').appendChild(createNewDateControls(false));
    document.getElementById('sheet-memo-toggle').addEventListener('click', async () => {
      await flushSheetMemos();
      sheetMemo = !sheetMemo;
      localStorage.setItem('denki_sheet_memo', sheetMemo ? '1' : '0');
      renderSheet();
    });
  }
  const last = minutesList[0];
  document.getElementById('sheet-meta').textContent = last
    ? `前回の議事録 ${fmtMeetingDate(last.meeting_date)}` : '議事録はまだありません';

  // 工番の絞り込み
  const pnBox = document.getElementById('sheet-pns');
  pnBox.innerHTML = '';
  const chip = (label, on, title, onClick) => {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', async () => { await flushSheetMemos(); onClick(); saveSheetPns(); renderSheet(); });
    pnBox.appendChild(b);
  };
  chip('すべて', !sheetPns, 'すべての工番を表示', () => { sheetPns = null; });
  [...new Map(currentProjects.map(p => [p.project_number, p])).values()].forEach(p => {
    chip(p.project_number, !!sheetPns && sheetPns.has(p.project_number), `${p.project_number} ${p.customer_name || ''}`, () => {
      if (!sheetPns) sheetPns = new Set();
      if (sheetPns.has(p.project_number)) sheetPns.delete(p.project_number); else sheetPns.add(p.project_number);
      if (!sheetPns.size) sheetPns = null;
    });
  });
  const mt = document.getElementById('sheet-memo-toggle');
  mt.textContent = sheetMemo ? 'メモを隠す' : 'メモを表示';
  mt.title = sheetMemo ? 'メモの列を隠して、状態だけを一覧にします' : 'メモの列を表示します';
}

function saveSheetPns() {
  // 工番管理で外した工番が残っていても、表示のときに無視されるだけ
  try { localStorage.setItem('denki_sheet_pns', JSON.stringify(sheetPns ? [...sheetPns] : [])); } catch (_) { /* 覚えられなくても表示はする */ }
}

// 左メニューの工番を押したとき、表の工番の列まで横に動かす
function scrollSheetToProject(pn) {
  if (sheetPns && !sheetPns.has(pn)) { sheetPns.add(pn); saveSheetPns(); renderSheet().then(() => scrollSheetToProject(pn)); return; }
  const wrap = document.getElementById('sheet-wrap');
  const th = wrap.querySelector(`th.sh-pn[data-pn="${CSS.escape(pn)}"]`);
  const fixed = wrap.querySelector('thead th.sh-flow');
  if (!th || !fixed) return;
  const left = fixed.getBoundingClientRect().right - wrap.getBoundingClientRect().left;
  wrap.scrollTo({ left: wrap.scrollLeft + th.getBoundingClientRect().left - wrap.getBoundingClientRect().left - left, behavior: 'smooth' });
}
