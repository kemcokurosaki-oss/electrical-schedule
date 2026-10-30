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
  const d = getProcData(proj, proc);
  const td = document.createElement('td');
  td.className = 'tl-cell st-' + getStatusClass(d.status);
  if (d.linked) {
    td.classList.add('linked');
    td.title = '全体工程表と連携（完了にすると全体工程表のタスクも完了になります）';
  }

  if (!canEdit) {
    td.textContent = d.status;
    return td;
  }
  const sel = document.createElement('select');
  sel.className = 'tl-select';
  ['', ...STATUS_LIST].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v || '─';
    sel.appendChild(o);
  });
  sel.value = d.status;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    if (await saveStatus(proj, proc, sel.value)) renderTaskList();
  });
  td.appendChild(sel);
  return td;
}

// ─── 保存 ─────────────────────────────────────────
// 連携項目（全体工程表のタスクがあるもの）は、完了かどうかを tasks.is_completed にも書く。
// 以前の表形式で入力した日付・担当者・メモは消さずにそのまま残す
async function saveStatus(proj, proc, status) {
  if (!canEdit) return false;
  const key = procKey(proj, proc);
  const d = getProcData(proj, proc);
  const rec = { status: null, start_date: null, end_date: null, tantousha: null, memo: null, ...(statusMap[key] || {}) };

  try {
    if (d.linked) {
      const done = status === '完了';
      if (done !== !!linkedMap[key].completed) {
        const { data, error } = await sb.from('tasks').update({ is_completed: done }).eq('id', d.taskId).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('全体工程表のタスクを更新できませんでした（権限がないか、ログインが切れています）');
        linkedMap[key].completed = done;
      }
      rec.status = done ? null : (status || null);
    } else {
      rec.status = status || null;
    }

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
    alert(`保存できませんでした。\n${e.message || e}\n\n画面を保存済みの内容に戻します。ログインが切れている場合は、ページを再読み込みしてください。`);
    await refreshDisplay();
    return false;
  }
}
