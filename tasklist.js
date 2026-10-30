// ─── タスクリスト ─────────────────────────────────────
// 工番ごとに 1 つの表。行が項目（1〜22）、列が機種。各マスでステータスを選ぶ
const tasklistCollapsed = new Set(); // 折りたたんでいる工番

function renderTaskList() {
  const wrap = document.getElementById('tasklist-wrapper');
  wrap.innerHTML = '';
  if (currentProjects.length === 0) {
    const p = document.createElement('div');
    p.className = 'no-data';
    p.textContent = '表示する列がありません。ヘッダーの「工番管理」から工番と機種を追加してください。';
    wrap.appendChild(p);
    return;
  }

  const groups = [];
  currentProjects.forEach(p => {
    const last = groups[groups.length - 1];
    if (last && last.pn === p.project_number) last.cols.push(p);
    else groups.push({ pn: p.project_number, customer: p.customer_name, cols: [p] });
  });
  groups.forEach(g => wrap.appendChild(renderTaskListProject(g)));
}

function renderTaskListProject({ pn, customer, cols }) {
  const sec = document.createElement('section');
  sec.className = 'tl-project' + (tasklistCollapsed.has(pn) ? ' collapsed' : '');

  const head = document.createElement('button');
  head.className = 'tl-project-head';
  head.innerHTML = '<span class="tl-toggle"></span><span class="tl-pn"></span><span class="tl-customer"></span><span class="tl-summary"></span>';
  head.querySelector('.tl-pn').textContent = pn;
  head.querySelector('.tl-customer').textContent = customer || '';
  head.querySelector('.tl-summary').textContent =
    cols.map(c => { const pr = progressOf(c); return `${c.machine || '(機種なし)'} ${pr.done}/${pr.total}`; }).join('　');
  head.addEventListener('click', () => {
    if (tasklistCollapsed.has(pn)) tasklistCollapsed.delete(pn); else tasklistCollapsed.add(pn);
    sec.classList.toggle('collapsed');
  });
  sec.appendChild(head);

  const table = document.createElement('table');
  table.className = 'tl-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  ['No.', '項目', '流れ'].forEach((t, i) => {
    const th = document.createElement('th');
    th.textContent = t;
    th.className = ['tl-no', 'tl-name', 'tl-flow'][i];
    htr.appendChild(th);
  });
  cols.forEach(c => {
    const th = document.createElement('th');
    th.className = 'tl-machine';
    const pr = progressOf(c);
    th.innerHTML = '<div class="tl-machine-name"></div><div class="tl-machine-progress"></div>';
    th.querySelector('.tl-machine-name').textContent = c.machine || '(機種なし)';
    th.querySelector('.tl-machine-progress').textContent = `完了 ${pr.done}/${pr.total}`;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  PROCESSES.forEach(proc => {
    const tr = document.createElement('tr');
    tr.className = 'dept-' + (PROCESS_DEPT[proc.no] || 'other');
    const tdNo = document.createElement('td'); tdNo.className = 'tl-no'; tdNo.textContent = proc.no;
    const tdName = document.createElement('td'); tdName.className = 'tl-name'; tdName.textContent = proc.name;
    const tdFlow = document.createElement('td'); tdFlow.className = 'tl-flow'; tdFlow.textContent = PROCESS_FLOW[proc.no] || '';
    tr.appendChild(tdNo); tr.appendChild(tdName); tr.appendChild(tdFlow);
    cols.forEach(c => tr.appendChild(renderStatusCell(c, proc)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(table);
  return sec;
}

function renderStatusCell(proj, proc) {
  const status = statusOf(proj, proc);
  const td = document.createElement('td');
  td.className = 'tl-cell st-' + getStatusClass(status);

  if (!canEdit) {
    td.textContent = status;
    return td;
  }
  const sel = document.createElement('select');
  sel.className = 'tl-select';
  ['', ...STATUS_LIST].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v || '─';
    sel.appendChild(o);
  });
  sel.value = status;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    if (await saveStatus(proj, proc, sel.value)) renderTaskList();
  });
  td.appendChild(sel);
  return td;
}

// ─── 保存 ─────────────────────────────────────────
// 電気工程表だけに保存する（全体工程表には書かない）。以前の表形式で入力した日付・担当者・メモは消さずに残す
async function saveStatus(proj, proc, status) {
  if (!canEdit) return false;
  const key = procKey(proj, proc);
  const rec = { status: null, start_date: null, end_date: null, tantousha: null, memo: null, ...(statusMap[key] || {}) };
  rec.status = status || null;

  try {
    const isEmpty = !rec.status && !rec.start_date && !rec.end_date && !rec.tantousha && !rec.memo;
    if (isEmpty) {
      if (statusMap[key]) {
        const { data, error } = await sb.from('denki_process_status').delete()
          .eq('project_number', proj.project_number).eq('machine', proj.machine).eq('process_no', proc.no)
          .select('process_no');
        if (error) throw error;
        if (!data.length) throw new Error('削除できませんでした（権限がないか、ログインが切れています）');
        delete statusMap[key];
      }
    } else {
      const { error } = await sb.from('denki_process_status').upsert(
        { project_number: proj.project_number, machine: proj.machine, process_no: proc.no, ...rec },
        { onConflict: 'project_number,machine,process_no' }
      );
      if (error) throw error;
      statusMap[key] = rec;
    }
    return true;
  } catch (e) {
    console.warn('保存エラー:', e);
    alert(`保存できませんでした。
${e.message || e}

画面を保存済みの内容に戻します。ログインが切れている場合は、ページを再読み込みしてください。`);
    await refreshDisplay();
    return false;
  }
}
