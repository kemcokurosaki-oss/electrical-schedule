// ─── 詳細ビュー ───────────────────────────────────────
function updateDetailButtons() {
  document.querySelectorAll('.btn-detail').forEach(btn => {
    const isOpen = currentDetailProjNum === String(btn.dataset.projNum);
    btn.innerHTML = isOpen ? SVG_COLLAPSE : SVG_EXPAND;
    btn.title     = isOpen ? '一覧に戻る' : '詳細表示';
  });
}

function openDetailView(projNum) {
  currentDetailProjNum = String(projNum);
  document.getElementById('view-table').style.display = 'none';
  document.getElementById('view-detail').style.display = 'block';
  renderDetailTable(projNum);
  updateDetailButtons();
}

function closeDetailView() {
  currentDetailProjNum = null;
  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-table').style.display = '';
  updateDetailButtons();
}

function renderDetailTable(projNum) {
  const projsForNum = currentProjects.filter(p => String(p.project_number) === String(projNum));
  if (projsForNum.length === 0) return;

  const pi0 = projsForNum[0];
  document.getElementById('detail-info-bar').textContent =
    `工番: ${projNum}　客先: ${pi0.customer_name || '─'}`;

  const table = document.createElement('table');
  table.className = 'detail-table';
  const thead = document.createElement('thead');

  // ヘッダー行1: 機種名（各機種は3列: 開始日・終了日・メモ）
  const htr1 = document.createElement('tr');
  const hthNo = document.createElement('th'); hthNo.className = 'col-no'; hthNo.rowSpan = 2; hthNo.textContent = 'No.'; htr1.appendChild(hthNo);
  const hthItem = document.createElement('th'); hthItem.className = 'col-item'; hthItem.rowSpan = 2; hthItem.textContent = '工程名'; htr1.appendChild(hthItem);
  projsForNum.forEach(proj => {
    const th = document.createElement('th');
    th.colSpan = 3;
    th.className = 'header-machine-group';
    th.textContent = `機種: ${proj.machine || '─'}`;
    htr1.appendChild(th);
  });
  thead.appendChild(htr1);

  // ヘッダー行2: 開始日・終了日・メモ
  const htr2 = document.createElement('tr');
  projsForNum.forEach(() => {
    ['開始日', '終了日', 'メモ'].forEach(lbl => {
      const th = document.createElement('th');
      th.textContent = lbl;
      th.style.fontSize = '11px';
      htr2.appendChild(th);
    });
  });
  thead.appendChild(htr2);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  PROCESSES.forEach(proc => {
    const deptClass = PROCESS_DEPT[proc.no] ? `dept-${PROCESS_DEPT[proc.no]}` : '';

    const trDate  = document.createElement('tr');
    if (deptClass) trDate.className = deptClass;

    const tdNo = document.createElement('td'); tdNo.className = 'col-no'; tdNo.rowSpan = 3; tdNo.textContent = proc.no;
    const tdItem = document.createElement('td'); tdItem.className = 'col-item'; tdItem.rowSpan = 3;
    if (proc.linked) tdItem.title = '全体工程表と連携';
    const nameSpan = document.createElement('span'); nameSpan.textContent = proc.name; tdItem.appendChild(nameSpan);
    if (PROCESS_FLOW[proc.no]) {
      tdItem.appendChild(document.createElement('br'));
      const flowSpan = document.createElement('span');
      flowSpan.textContent = PROCESS_FLOW[proc.no];
      flowSpan.style.fontSize = '11px';
      tdItem.appendChild(flowSpan);
    }
    trDate.appendChild(tdNo);
    trDate.appendChild(tdItem);

    const trStat  = document.createElement('tr');
    trStat.className = (deptClass ? deptClass + ' ' : '') + 'detail-row-stat';

    const trOwner = document.createElement('tr');
    trOwner.className = (deptClass ? deptClass + ' ' : '') + 'detail-row-owner';

    projsForNum.forEach(proj => {
      const key = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
      const rec = statusMap[key] || {};

      let startDate, endDate, owner;
      if (proc.linked) {
        const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
        startDate = currentLinkedMap[lk]?.start_date || '';
        endDate   = currentLinkedMap[lk]?.end_date   || '';
        owner     = currentLinkedMap[lk]?.owner || '';
      } else {
        startDate = rec.start_date || '';
        endDate   = rec.end_date   || '';
        owner     = rec.tantousha  || '';
      }

      // Row1: 開始日 | 終了日 | メモ(rowspan=3)
      const tdStart = document.createElement('td');
      tdStart.className = 'detail-date' + (proc.linked ? ' linked' : '');
      tdStart.textContent = fmtDate(startDate);

      const tdEnd = document.createElement('td');
      tdEnd.className = 'detail-date' + (proc.linked ? ' linked' : '');
      tdEnd.textContent = fmtDate(endDate);

      const tdMemo = document.createElement('td');
      tdMemo.className = 'detail-memo-cell';
      tdMemo.rowSpan = 3;

      trDate.appendChild(tdStart);
      trDate.appendChild(tdEnd);
      trDate.appendChild(tdMemo);

      // Row2: ステータス(colspan=2)
      const tdStatus = document.createElement('td');
      tdStatus.className = 'detail-status';
      tdStatus.colSpan = 2;
      const statusSpan = document.createElement('span');
      statusSpan.className = 'status-label';
      if (proc.linked) {
        const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
        applyStatusStyle(tdStart, tdStatus, statusSpan, calcLinkedStatus(currentLinkedMap[lk]?.start_date, currentLinkedMap[lk]?.end_date, currentLinkedMap[lk]?.status));
      } else {
        applyStatusStyle(tdStart, tdStatus, statusSpan, rec.status || '');
      }
      tdStatus.appendChild(statusSpan);
      trStat.appendChild(tdStatus);

      // Row3: 担当者(colspan=2)
      const tdOwner = document.createElement('td');
      tdOwner.className = 'detail-owner' + (proc.linked ? ' linked' : '');
      tdOwner.colSpan = 2;
      const ownerSpan = document.createElement('span');
      ownerSpan.textContent = owner;
      tdOwner.appendChild(ownerSpan);
      trOwner.appendChild(tdOwner);

      if (!proc.linked) {
        tdStart.addEventListener('dblclick', () => editDetailDateCell(tdStart, tdEnd, proj, proc));
        tdEnd.addEventListener('dblclick',   () => editDetailDateCell(tdStart, tdEnd, proj, proc));
        tdStatus.addEventListener('dblclick', () => editStatusCell(tdStatus, tdStart, proj, proc));
        tdOwner.addEventListener('dblclick', () => editOwnerCell(tdOwner, proj, proc));
      } else {
        tdStart.addEventListener('dblclick', () => editLinkedDetailDateCell(tdStart, tdEnd, proj, proc));
        tdEnd.addEventListener('dblclick',   () => editLinkedDetailDateCell(tdStart, tdEnd, proj, proc));
        tdStatus.addEventListener('dblclick', () => editLinkedStatusCell(tdStatus, tdStart, proj, proc));
        tdOwner.addEventListener('dblclick', () => editLinkedOwnerCell(tdOwner, proj, proc));
      }

      const ta = document.createElement('textarea');
      ta.className   = 'detail-memo';
      ta.rows        = 3;
      ta.value       = rec.memo || '';
      ta.readOnly    = true;
      ta.addEventListener('dblclick', () => {
        ta._origMemo = ta.value;
        ta.readOnly  = false;
        ta.focus();
        ta.select();
      });
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          ta.blur();
        }
        if (e.key === 'Escape') {
          ta.value    = ta._origMemo ?? (rec.memo || '');
          ta.readOnly = true;
          ta.blur();
        }
      });
      ta.addEventListener('blur', async () => {
        if (ta.readOnly) return;
        ta.readOnly = true;
        const newMemo = ta.value.trim() || null;
        const curRec  = statusMap[key] || {};
        if ((newMemo || null) === (curRec.memo || null)) return;
        await saveRecord(proj.project_number, proj.machine || '', proc.no, {
          status: curRec.status || null, start_date: curRec.start_date || null,
          end_date: curRec.end_date || null, tantousha: curRec.tantousha || null,
          memo: newMemo,
        });
        const isEmpty = !curRec.status && !curRec.start_date && !curRec.end_date && !curRec.tantousha && !newMemo;
        if (isEmpty) delete statusMap[key];
        else statusMap[key] = { ...curRec, memo: newMemo };
      });
      tdMemo.appendChild(ta);
    });

    tbody.appendChild(trDate);
    tbody.appendChild(trStat);
    tbody.appendChild(trOwner);
  });

  // 出荷日行（1行）
  const trShip1 = document.createElement('tr'); trShip1.className = 'row-shipping';

  const tdNoS   = document.createElement('td'); tdNoS.className = 'col-no'; tdNoS.textContent = '23';
  const tdItemS = document.createElement('td'); tdItemS.className = 'col-item'; tdItemS.textContent = '工場出荷日';
  trShip1.appendChild(tdNoS); trShip1.appendChild(tdItemS);

  projsForNum.forEach(proj => {
    const tdShip = document.createElement('td');
    tdShip.className = 'detail-date linked';
    tdShip.colSpan = 3;
    tdShip.textContent = fmtDate(proj.start_date);
    trShip1.appendChild(tdShip);
  });
  tbody.appendChild(trShip1);

  table.appendChild(tbody);
  const container = document.getElementById('detail-table-container');
  container.innerHTML = '';
  container.appendChild(table);
}

document.getElementById('btn-detail-back').addEventListener('click', () => closeDetailView());
