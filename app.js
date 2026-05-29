// ─── タブ切替 ────────────────────────────────────────────
document.getElementById('tab-table').addEventListener('click', () => {
  document.getElementById('tab-table').classList.add('active');
  document.getElementById('tab-gantt').classList.remove('active');
  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-table').style.display = '';
  document.getElementById('view-gantt').classList.remove('active');
  currentDetailProjNum = null;
  updateDetailButtons();
});

document.getElementById('tab-gantt').addEventListener('click', () => {
  document.getElementById('tab-gantt').classList.add('active');
  document.getElementById('tab-table').classList.remove('active');
  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-table').style.display = 'none';
  document.getElementById('view-gantt').classList.add('active');
  currentDetailProjNum = null;
  setTimeout(() => showGantt(), 50);
});

// ─── ポップアップ操作 ─────────────────────────────────
function openPopup({ projNum, machine, procNo, procName,
                     dateTd, statusTd, statusSpan, ownerSpan, dateRangeSpan,
                     source, ganttId }) {
  const key = `${projNum}__${machine}__${procNo}`;
  const rec = statusMap[key] || {};

  document.getElementById('popup-proc-name').textContent = `No.${procNo}　${procName}`;
  document.getElementById('popup-proj-info').textContent = `工番: ${projNum}　機種: ${machine || '─'}`;
  document.getElementById('popup-status').value = rec.status || '';
  document.getElementById('popup-start').value  = rec.start_date || '';
  document.getElementById('popup-end').value    = rec.end_date   || '';

  const ownerSel = document.getElementById('popup-owner');
  ownerSel.innerHTML = '<option value="">─</option>';
  (PROCESS_OWNERS[procNo] || []).forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    ownerSel.appendChild(o);
  });
  ownerSel.value = rec.tantousha || '';

  editCtx = { projNum, machine, procNo, key,
              dateTd, statusTd, statusSpan, ownerSpan, dateRangeSpan,
              source: source || 'table', ganttId: ganttId || null };
  document.getElementById('edit-popup').classList.add('active');
}

function closePopup() {
  document.getElementById('edit-popup').classList.remove('active');
  editCtx = null;
}

document.getElementById('edit-popup').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-popup')) closePopup();
});
document.getElementById('popup-cancel').addEventListener('click', closePopup);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });

document.getElementById('popup-save').addEventListener('click', async () => {
  if (!editCtx) return;

  const status     = document.getElementById('popup-status').value;
  const start_date = document.getElementById('popup-start').value || null;
  const end_date   = document.getElementById('popup-end').value   || null;
  const tantousha  = document.getElementById('popup-owner').value || null;

  const existingMemo = (statusMap[editCtx.key] || {}).memo || null;
  await saveRecord(editCtx.projNum, editCtx.machine, editCtx.procNo, { status, start_date, end_date, tantousha, memo: existingMemo });

  const isEmpty = !status && !start_date && !end_date && !tantousha && !existingMemo;
  if (isEmpty) {
    delete statusMap[editCtx.key];
  } else {
    statusMap[editCtx.key] = { status, start_date, end_date, tantousha, memo: existingMemo };
  }

  if (editCtx.source === 'gantt' && editCtx.ganttId) {
    try {
      const task = gantt.getTask(editCtx.ganttId);
      if (task) {
        task.owner       = tantousha || '';
        task.statusClass = getStatusClass(status);
        task.statusLabel = status || '';
        task.start_date_str = start_date || task.start_date_str;
        task.end_date_str   = end_date || null;
        if (start_date) task.start_date = parseLocalDate(start_date);
        if (end_date) {
          const endD = parseLocalDate(end_date);
          endD.setDate(endD.getDate() + 1);
          task.end_date = endD;
          task.duration = Math.round((endD - task.start_date) / 86400000);
        } else {
          task.duration = 1;
        }
        gantt.updateTask(editCtx.ganttId);
      }
    } catch(e) { console.warn('Gantt update:', e); }
  } else {
    applyStatusStyle(editCtx.dateTd, editCtx.statusTd, editCtx.statusSpan, status);
    if (editCtx.ownerSpan)     editCtx.ownerSpan.textContent = tantousha || '';
    if (editCtx.dateRangeSpan) editCtx.dateRangeSpan.textContent = fmtDate(start_date);
  }

  closePopup();
});

// ─── メイン処理 ───────────────────────────────────────
async function init() {
  const { data: completedData } = await sb.from('completed_projects').select('project_number');
  const completedNums = new Set((completedData || []).map(c => String(c.project_number)));

  const { data: shipTasks, error: e1 } = await sb
    .from('tasks')
    .select('project_number, machine, customer_name, start_date')
    .eq('text', '工場出荷')
    .order('project_number', { ascending: true });

  if (e1) { console.error(e1); hideLoading(); return; }

  const seen = new Set();
  allAvailableProjects = (shipTasks || []).filter(p => {
    if (completedNums.has(String(p.project_number))) return false;
    const key = `${p.project_number}__${p.machine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { data: visibleData } = await sb.from('denki_visible_projects').select('project_number');
  visibleProjectNums = new Set((visibleData || []).map(r => String(r.project_number)));

  currentProjects = allAvailableProjects.filter(p => visibleProjectNums.has(String(p.project_number)));

  if (currentProjects.length === 0) {
    hideLoading();
    document.getElementById('no-data').style.display = 'block';
    return;
  }

  const linkedTexts   = PROCESSES.filter(p => p.linked).map(p => p.taskText);
  const projectNumbers = [...new Set(currentProjects.map(p => p.project_number))];

  const { data: linkedTasks } = await sb
    .from('tasks')
    .select('id, project_number, machine, text, start_date, end_date, owner, status, is_completed')
    .in('project_number', projectNumbers)
    .in('text', linkedTexts);

  currentLinkedMap = {};
  (linkedTasks || []).forEach(t => {
    const key = `${t.project_number}__${t.machine}__${t.text}`;
    if (!currentLinkedMap[key]) currentLinkedMap[key] = { id: t.id, start_date: t.start_date, end_date: t.end_date, owner: t.owner || '', status: t.is_completed ? '完了' : (t.status || '') };
  });

  const { data: custData } = await sb
    .from('tasks')
    .select('project_number, customer_name')
    .in('project_number', projectNumbers)
    .not('customer_name', 'is', null);
  const custMap = {};
  (custData || []).forEach(t => {
    if (t.customer_name && !custMap[t.project_number]) custMap[t.project_number] = t.customer_name;
  });
  currentProjects.forEach(p => {
    if (!p.customer_name) p.customer_name = custMap[p.project_number];
  });

  statusMap = {};
  try {
    const { data: statusData } = await sb
      .from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, tantousha, memo');
    (statusData || []).forEach(s => {
      statusMap[`${s.project_number}__${s.machine}__${s.process_no}`] = {
        status:     s.status,
        start_date: s.start_date,
        end_date:   s.end_date,
        tantousha:  s.tantousha,
        memo:       s.memo,
      };
    });
  } catch(e) { /* ignore */ }

  renderTable(currentProjects, currentLinkedMap);
  document.getElementById('main-table').style.display = '';
  hideLoading();
}

init();
