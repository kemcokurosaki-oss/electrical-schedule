// ─── 表レンダリング ───────────────────────────────────
function renderTable(projects) {
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
    const trDate   = document.createElement('tr'); trDate.className   = `row-date${deptClass}`;
    const trStatus = document.createElement('tr'); trStatus.className = `row-status${deptClass}`;
    const trOwner  = document.createElement('tr'); trOwner.className  = `row-owner${deptClass}`;

    const addHead = (tr, noText, itemText) => {
      const tdNo = document.createElement('td'); tdNo.className = 'col-no'; tdNo.textContent = noText;
      const tdItem = document.createElement('td'); tdItem.className = 'col-item'; tdItem.textContent = itemText;
      tr.appendChild(tdNo); tr.appendChild(tdItem);
      return tdItem;
    };
    const tdItem = addHead(trDate, proc.no, proc.name);
    if (proc.linked) tdItem.title = `全体工程表と連携（${proc.taskTexts[0]}）`;
    addHead(trStatus, '', PROCESS_FLOW[proc.no] || '');
    addHead(trOwner, '', '');

    projects.forEach((proj, pi) => {
      const d = getProcData(proj, proc);
      const end = groupEndIdx.has(pi) ? ' proj-group-end' : '';
      const linkedCls = d.linked ? ' linked' : '';
      const linkedTitle = d.linked ? '全体工程表と連携しています' : '';

      const dateTd = document.createElement('td');
      dateTd.className = 'cell-date' + linkedCls + end;
      dateTd.textContent = fmtDate(d.start_date);
      dateTd.title = [fmtDateRange(d.start_date, d.end_date), linkedTitle].filter(Boolean).join('\n');

      const statusTd = document.createElement('td');
      statusTd.className = 'cell-status' + end;
      const statusSpan = document.createElement('span');
      applyStatusStyle(dateTd, statusTd, statusSpan, d.status);
      statusTd.appendChild(statusSpan);

      const ownerTd = document.createElement('td');
      ownerTd.className = 'cell-owner' + linkedCls + end;
      const ownerSpan = document.createElement('span');
      ownerSpan.textContent = d.owner || '';
      ownerTd.appendChild(ownerSpan);

      dateTd.addEventListener('dblclick',   () => editDateCell(dateTd, proj, proc));
      statusTd.addEventListener('dblclick', () => editStatusCell(statusTd, proj, proc));
      ownerTd.addEventListener('dblclick',  () => editOwnerCell(ownerTd, proj, proc));

      trDate.appendChild(dateTd);
      trStatus.appendChild(statusTd);
      trOwner.appendChild(ownerTd);
    });
    tbody.appendChild(trDate);
    tbody.appendChild(trStatus);
    tbody.appendChild(trOwner);
  });

  // 出荷日行（全体工程表の工場出荷）
  const trShip = document.createElement('tr');
  trShip.className = 'row-shipping';
  const tdNoShip = document.createElement('td'); tdNoShip.className = 'col-no'; tdNoShip.textContent = '23';
  const tdItemShip = document.createElement('td'); tdItemShip.className = 'col-item'; tdItemShip.textContent = '工場出荷日';
  trShip.appendChild(tdNoShip);
  trShip.appendChild(tdItemShip);
  projects.forEach((proj, pi) => {
    const td = document.createElement('td');
    td.className = 'cell-date linked' + (groupEndIdx.has(pi) ? ' proj-group-end' : '');
    fillShipCell(td, proj);
    trShip.appendChild(td);
  });
  tbody.appendChild(trShip);
}

// 工場出荷日。同じ機種に工場出荷が複数あるときは一番早い日を出し、全部の日付をツールチップに出す
function fillShipCell(td, proj) {
  const dates = shipMap[`${proj.project_number}__${proj.machine}`] || [];
  td.textContent = fmtDate(dates[0]) + (dates.length > 1 ? ' 他' : '');
  if (dates.length > 1) td.title = dates.map(fmtDate).join('\n');
}
