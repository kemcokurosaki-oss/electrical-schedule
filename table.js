// ─── 表レンダリング ───────────────────────────────────
function renderTable(projects, linkedMap) {
  const thead = document.getElementById('thead');
  const tbody = document.getElementById('tbody');

  const projectGroups = [];
  let prevNum = null;
  projects.forEach(p => {
    if (p.project_number === prevNum) {
      projectGroups[projectGroups.length - 1].count++;
    } else {
      projectGroups.push({ project_number: p.project_number, customer_name: p.customer_name, count: 1 });
      prevNum = p.project_number;
    }
  });

  let _cum = 0;
  const groupEndIdx = new Set();
  projectGroups.forEach((g, gi) => {
    _cum += g.count;
    if (gi < projectGroups.length - 1) groupEndIdx.add(_cum - 1);
  });

  thead.innerHTML = '';

  // 行1: 工番 + 詳細ボタン
  {
    const tr = document.createElement('tr');
    const thNo = document.createElement('th'); thNo.className = 'col-no'; tr.appendChild(thNo);
    const thItem = document.createElement('th'); thItem.className = 'col-item'; thItem.textContent = '工番'; tr.appendChild(thItem);
    projectGroups.forEach((g, gi) => {
      const th = document.createElement('th');
      th.className = 'header-number' + (gi < projectGroups.length - 1 ? ' proj-group-end' : '');
      th.textContent = g.project_number;
      if (g.count > 1) th.colSpan = g.count;
      const btn = document.createElement('button');
      btn.className = 'btn-detail';
      btn.dataset.projNum = String(g.project_number);
      btn.innerHTML = currentDetailProjNum === String(g.project_number) ? SVG_COLLAPSE : SVG_EXPAND;
      btn.title = currentDetailProjNum === String(g.project_number) ? '一覧に戻る' : '詳細表示';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (currentDetailProjNum === String(g.project_number)) {
          closeDetailView();
        } else {
          openDetailView(String(g.project_number));
        }
      });
      th.appendChild(btn);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  // 行2: 客先名
  {
    const tr = document.createElement('tr');
    const thNo = document.createElement('th'); thNo.className = 'col-no'; tr.appendChild(thNo);
    const thItem = document.createElement('th'); thItem.className = 'col-item'; thItem.textContent = '客先'; tr.appendChild(thItem);
    projectGroups.forEach((g, gi) => {
      const th = document.createElement('th');
      th.className = 'header-client' + (gi < projectGroups.length - 1 ? ' proj-group-end' : '');
      th.textContent = g.customer_name || '─';
      if (g.customer_name) th.title = g.customer_name;
      if (g.count > 1) th.colSpan = g.count;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  // 行3: 機種
  {
    const tr = document.createElement('tr');
    const thNo = document.createElement('th'); thNo.className = 'col-no'; tr.appendChild(thNo);
    const thItem = document.createElement('th'); thItem.className = 'col-item'; thItem.textContent = '機種'; tr.appendChild(thItem);
    projects.forEach((p, pi) => {
      const th = document.createElement('th');
      th.className = 'header-machine' + (groupEndIdx.has(pi) ? ' proj-group-end' : '');
      th.textContent = p.machine || '─';
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }

  tbody.innerHTML = '';

  PROCESSES.forEach(proc => {
    const deptClass = PROCESS_DEPT[proc.no] ? ` dept-${PROCESS_DEPT[proc.no]}` : '';
    // 日付行
    const trDate = document.createElement('tr');
    trDate.className = `row-date${deptClass}`;
    const tdNo = document.createElement('td'); tdNo.className = 'col-no'; tdNo.textContent = proc.no;
    const tdItem = document.createElement('td'); tdItem.className = 'col-item'; tdItem.textContent = proc.name;
    if (proc.linked) tdItem.title = '全体工程表と連携';
    trDate.appendChild(tdNo);
    trDate.appendChild(tdItem);

    const dateTds = [];
    const dateRangeSpans = [];

    projects.forEach((proj, pi) => {
      const td = document.createElement('td');
      td.className = 'cell-date' + (proc.linked ? ' linked' : '') + (groupEndIdx.has(pi) ? ' proj-group-end' : '');
      if (proc.linked) {
        const key = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
        td.textContent = fmtDate(linkedMap[key]?.start_date);
        dateRangeSpans.push(null);
      } else {
        const statusKey = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
        const rec = statusMap[statusKey] || {};
        const span = document.createElement('span');
        span.textContent = fmtDate(rec.start_date);
        td.appendChild(span);
        dateRangeSpans.push(span);
      }
      dateTds.push(td);
      trDate.appendChild(td);
    });
    tbody.appendChild(trDate);

    // 担当者行
    const trOwner = document.createElement('tr');
    trOwner.className = `row-owner${deptClass}`;
    const tdNoO = document.createElement('td'); tdNoO.className = 'col-no';
    const tdItemO = document.createElement('td'); tdItemO.className = 'col-item';
    trOwner.appendChild(tdNoO);
    trOwner.appendChild(tdItemO);

    const ownerSpans = [];
    projects.forEach((proj, pi) => {
      const statusKey = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
      const rec = statusMap[statusKey] || {};
      const td = document.createElement('td');
      td.className = 'cell-owner' + (proc.linked ? ' linked' : '') + (groupEndIdx.has(pi) ? ' proj-group-end' : '');
      const span = document.createElement('span');
      let displayOwner;
      if (proc.linked) {
        const linkedKey = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
        displayOwner = linkedMap[linkedKey]?.owner || '';
      } else {
        displayOwner = rec.tantousha || '';
      }
      span.textContent = displayOwner;
      td.appendChild(span);
      ownerSpans.push(span);
      trOwner.appendChild(td);
    });

    // ステータス行
    const trStatus = document.createElement('tr');
    trStatus.className = `row-status${deptClass}`;
    const tdNoS = document.createElement('td'); tdNoS.className = 'col-no';
    const tdItemS = document.createElement('td'); tdItemS.className = 'col-item'; tdItemS.textContent = PROCESS_FLOW[proc.no] || '';
    trStatus.appendChild(tdNoS);
    trStatus.appendChild(tdItemS);

    projects.forEach((proj, pi) => {
      const statusKey = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
      const rec = statusMap[statusKey] || {};
      const dateTd = dateTds[pi];

      const td = document.createElement('td');
      td.className = 'cell-status' + (groupEndIdx.has(pi) ? ' proj-group-end' : '');

      const statusSpan = document.createElement('span');
      statusSpan.className = 'status-label';
      if (proc.linked) {
        const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
        applyStatusStyle(dateTd, td, statusSpan, calcLinkedStatus(currentLinkedMap[lk]?.start_date, currentLinkedMap[lk]?.end_date, currentLinkedMap[lk]?.status));
      } else {
        applyStatusStyle(dateTd, td, statusSpan, rec.status || '');
      }
      td.appendChild(statusSpan);

      if (!proc.linked) {
        td.addEventListener('dblclick', () => editStatusCell(td, dateTd, proj, proc));
        dateTd.addEventListener('dblclick', () => editDateCell(dateTd, proj, proc));
        const ownerTd = trOwner.children[pi + 2];
        ownerTd.addEventListener('dblclick', () => editOwnerCell(ownerTd, proj, proc));
      } else {
        td.addEventListener('dblclick', () => editLinkedStatusCell(td, dateTd, proj, proc));
        dateTd.addEventListener('dblclick', () => editLinkedDateCell(dateTd, proj, proc));
        const ownerTd = trOwner.children[pi + 2];
        ownerTd.addEventListener('dblclick', () => editLinkedOwnerCell(ownerTd, proj, proc));
      }

      trStatus.appendChild(td);
    });
    tbody.appendChild(trStatus);
    tbody.appendChild(trOwner);
  });

  // 出荷日行
  const trShip = document.createElement('tr');
  trShip.className = 'row-shipping';
  const tdNoShip = document.createElement('td'); tdNoShip.className = 'col-no'; tdNoShip.textContent = '23';
  const tdItemShip = document.createElement('td'); tdItemShip.className = 'col-item'; tdItemShip.textContent = '工場出荷日';
  trShip.appendChild(tdNoShip);
  trShip.appendChild(tdItemShip);
  projects.forEach((proj, pi) => {
    const td = document.createElement('td');
    td.className = 'cell-date linked' + (groupEndIdx.has(pi) ? ' proj-group-end' : '');
    td.textContent = fmtDate(proj.start_date);
    trShip.appendChild(td);
  });
  tbody.appendChild(trShip);
}
