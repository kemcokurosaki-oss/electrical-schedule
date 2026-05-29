// ─── 工番管理モーダル ─────────────────────────────────
document.getElementById('btn-manage').addEventListener('click', openManageModal);
document.getElementById('manage-close').addEventListener('click', closeManageModal);
document.getElementById('manage-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('manage-modal')) closeManageModal();
});

function openManageModal() {
  renderManageList();
  document.getElementById('manage-modal').classList.add('active');
}

function closeManageModal() {
  document.getElementById('manage-modal').classList.remove('active');
}

function renderManageList() {
  const statusBar = document.getElementById('manage-status');
  const list = document.getElementById('manage-list');

  const registeredCount = visibleProjectNums.size;
  statusBar.textContent = registeredCount === 0
    ? '登録されている工番はありません'
    : `${registeredCount}件の工番を登録中`;
  statusBar.className = 'manage-status-bar';

  list.innerHTML = '';

  const seenNums = new Set();
  const uniqueProjects = [];
  allAvailableProjects.forEach(p => {
    const pn = String(p.project_number);
    if (!seenNums.has(pn)) {
      seenNums.add(pn);
      uniqueProjects.push(p);
    }
  });

  uniqueProjects.sort((a, b) =>
    String(a.project_number).localeCompare(String(b.project_number))
  );

  uniqueProjects.forEach(p => {
    const pn = String(p.project_number);
    const isVisible = visibleProjectNums.has(pn);

    const machines = allAvailableProjects
      .filter(ap => String(ap.project_number) === pn && ap.machine)
      .map(ap => ap.machine)
      .join(' / ');

    const item = document.createElement('div');
    item.className = 'manage-item' + (isVisible ? ' is-visible' : '');

    const info = document.createElement('div');
    info.className = 'manage-item-info';

    const numSpan = document.createElement('span');
    numSpan.className = 'manage-item-num';
    numSpan.textContent = pn;
    info.appendChild(numSpan);

    const detail = [p.customer_name, machines].filter(Boolean).join('　');
    if (detail) {
      const detailSpan = document.createElement('span');
      detailSpan.className = 'manage-item-detail';
      detailSpan.textContent = detail;
      info.appendChild(detailSpan);
    }

    const btn = document.createElement('button');
    btn.className = 'manage-item-btn ' + (isVisible ? 'btn-rm-proj' : 'btn-add-proj');
    btn.textContent = isVisible ? '削除' : '追加';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '...';
      if (isVisible) {
        const { error } = await sb.from('denki_visible_projects').delete().eq('project_number', pn);
        if (error) { alert('削除に失敗しました: ' + error.message); btn.disabled = false; btn.textContent = '削除'; return; }
        visibleProjectNums.delete(pn);
      } else {
        const { error } = await sb.from('denki_visible_projects').insert({ project_number: pn });
        if (error) { alert('追加に失敗しました: ' + error.message); btn.disabled = false; btn.textContent = '追加'; return; }
        visibleProjectNums.add(pn);
      }
      renderManageList();
      await refreshDisplay();
    });

    item.appendChild(info);
    item.appendChild(btn);
    list.appendChild(item);
  });
}

async function refreshDisplay() {
  showLoading();

  currentProjects = allAvailableProjects.filter(p => visibleProjectNums.has(String(p.project_number)));

  if (currentProjects.length > 0) {
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

    const { data: statusData } = await sb
      .from('denki_process_status')
      .select('project_number, machine, process_no, status, start_date, end_date, tantousha, memo')
      .in('project_number', projectNumbers);

    statusMap = {};
    (statusData || []).forEach(s => {
      statusMap[`${s.project_number}__${s.machine}__${s.process_no}`] = {
        status: s.status, start_date: s.start_date, end_date: s.end_date,
        tantousha: s.tantousha, memo: s.memo,
      };
    });
  } else {
    currentLinkedMap = {};
    statusMap = {};
  }

  if (currentProjects.length === 0) {
    document.getElementById('main-table').style.display = 'none';
    document.getElementById('no-data').style.display = 'block';
  } else {
    document.getElementById('no-data').style.display = 'none';
    renderTable(currentProjects, currentLinkedMap);
    document.getElementById('main-table').style.display = '';
  }

  if (ganttInitialized) {
    gantt.clearAll();
    const data = buildGanttData();
    if (data.data.length > 0) gantt.parse(data);
  }

  hideLoading();
}
