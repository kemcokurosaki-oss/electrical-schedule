// ─── インライン編集 ───────────────────────────────
function closeActiveInlineEdit() {
  if (!activeInlineEdit) return;
  activeInlineEdit.cancel();
  activeInlineEdit = null;
}

function editStatusCell(td, dateTd, proj, proc) {
  closeActiveInlineEdit();
  const key = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
  const rec = statusMap[key] || {};
  const origHTML = td.innerHTML;

  td.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  [['', '─'], ['作業中', '作業中'], ['完了', '完了'], ['対象外', '対象外']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  });
  sel.value = rec.status || '';
  td.appendChild(sel);
  sel.focus();

  const cancel = () => { td.innerHTML = origHTML; };
  activeInlineEdit = { cancel };

  sel.addEventListener('change', async () => {
    const newStatus = sel.value;
    activeInlineEdit = null;
    td.innerHTML = '';
    const newSpan = document.createElement('span');
    newSpan.className = 'status-label';
    applyStatusStyle(dateTd, td, newSpan, newStatus);
    td.appendChild(newSpan);
    const curRec = statusMap[key] || {};
    await saveRecord(proj.project_number, proj.machine || '', proc.no, {
      status: newStatus, start_date: curRec.start_date || null,
      end_date: curRec.end_date || null, tantousha: curRec.tantousha || null,
      memo: curRec.memo || null,
    });
    const isEmpty = !newStatus && !curRec.start_date && !curRec.end_date && !curRec.tantousha && !curRec.memo;
    if (isEmpty) delete statusMap[key];
    else statusMap[key] = { ...curRec, status: newStatus };
  });

  sel.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineEdit && activeInlineEdit.cancel === cancel) {
        cancel(); activeInlineEdit = null;
      }
    }, 100);
  });
}

function editOwnerCell(td, proj, proc) {
  closeActiveInlineEdit();
  const key = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
  const rec = statusMap[key] || {};
  const origHTML = td.innerHTML;

  td.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  const emptyO = document.createElement('option');
  emptyO.value = ''; emptyO.textContent = '─';
  sel.appendChild(emptyO);
  (PROCESS_OWNERS[proc.no] || []).forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
  sel.value = rec.tantousha || '';
  td.appendChild(sel);
  sel.focus();

  const cancel = () => { td.innerHTML = origHTML; };
  activeInlineEdit = { cancel };

  sel.addEventListener('change', async () => {
    const newOwner = sel.value;
    activeInlineEdit = null;
    td.innerHTML = '';
    const newSpan = document.createElement('span');
    newSpan.textContent = newOwner;
    td.appendChild(newSpan);
    const curRec = statusMap[key] || {};
    await saveRecord(proj.project_number, proj.machine || '', proc.no, {
      status: curRec.status || null, start_date: curRec.start_date || null,
      end_date: curRec.end_date || null, tantousha: newOwner || null,
      memo: curRec.memo || null,
    });
    const isEmpty = !curRec.status && !curRec.start_date && !curRec.end_date && !newOwner && !curRec.memo;
    if (isEmpty) delete statusMap[key];
    else statusMap[key] = { ...curRec, tantousha: newOwner };
  });

  sel.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineEdit && activeInlineEdit.cancel === cancel) {
        cancel(); activeInlineEdit = null;
      }
    }, 100);
  });
}

function toDBDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function ensureDatePicker() {
  if (datePicker) return;
  const anchor = document.getElementById('fp-anchor');
  const label  = document.getElementById('fp-range-label');
  datePicker = flatpickr(anchor, {
    mode: 'range',
    showMonths: 2,
    locale: 'ja',
    dateFormat: 'Y-m-d',
    disableMobile: true,
    onChange: (selectedDates) => {
      if (selectedDates.length === 1) {
        label.textContent = `開始日: ${toDBDate(selectedDates[0])}　終了日: 選択中...`;
      } else if (selectedDates.length === 2) {
        label.textContent = `開始日: ${toDBDate(selectedDates[0])}　終了日: ${toDBDate(selectedDates[1])}`;
      }
    },
    onOpen: () => {
      label.style.display = 'block';
    },
    onClose: (selectedDates) => {
      label.style.display = 'none';
      activeInlineEdit = null;
      if (datePickerSave) {
        const newStart = selectedDates[0] ? toDBDate(selectedDates[0]) : null;
        const newEnd   = selectedDates[1] ? toDBDate(selectedDates[1]) : null;
        if (newStart || newEnd) datePickerSave(newStart, newEnd);
        datePickerSave = null;
      }
    },
  });
}

function editDateCell(td, proj, proc) {
  closeActiveInlineEdit();
  ensureDatePicker();

  const key = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
  const rec = statusMap[key] || {};

  const rect = td.getBoundingClientRect();
  const label = document.getElementById('fp-range-label');
  const anchor = document.getElementById('fp-anchor');
  anchor.style.top  = `${rect.top}px`;
  anchor.style.left = `${rect.right}px`;

  const posLabel = () => {
    const cal = document.querySelector('.flatpickr-calendar.open');
    if (cal) {
      const cr = cal.getBoundingClientRect();
      label.style.top  = `${cr.top - 22}px`;
      label.style.left = `${cr.left}px`;
      label.style.width = `${cr.width}px`;
    }
  };
  requestAnimationFrame(posLabel);

  datePickerSave = async (newStart, newEnd) => {
    td.innerHTML = '';
    const newSpan = document.createElement('span');
    newSpan.textContent = fmtDate(newStart);
    td.appendChild(newSpan);
    const curRec = statusMap[key] || {};
    await saveRecord(proj.project_number, proj.machine || '', proc.no, {
      status: curRec.status || null, start_date: newStart,
      end_date: newEnd, tantousha: curRec.tantousha || null,
      memo: curRec.memo || null,
    });
    const isEmpty = !curRec.status && !newStart && !newEnd && !curRec.tantousha && !curRec.memo;
    if (isEmpty) delete statusMap[key];
    else statusMap[key] = { ...curRec, start_date: newStart, end_date: newEnd };
  };

  const defaultDates = [rec.start_date, rec.end_date].filter(Boolean);
  datePicker.setDate(defaultDates, false);
  const initLabel = defaultDates.length === 2
    ? `開始日: ${defaultDates[0]}　終了日: ${defaultDates[1]}`
    : defaultDates.length === 1 ? `開始日: ${defaultDates[0]}　終了日: 未設定` : '開始日と終了日を選択してください';
  label.textContent = initLabel;

  datePicker.open();
  activeInlineEdit = { cancel: () => { datePickerSave = null; datePicker.close(); } };
}

async function saveRecord(projNum, machine, procNo, { status, start_date, end_date, tantousha, memo = null }) {
  const pn = String(projNum);
  const mc = machine || '';
  const isEmpty = !status && !start_date && !end_date && !tantousha && !memo;
  try {
    if (isEmpty) {
      await sb.from('denki_process_status').delete()
        .eq('project_number', pn).eq('machine', mc).eq('process_no', procNo);
    } else {
      await sb.from('denki_process_status').upsert(
        { project_number: pn, machine: mc, process_no: procNo,
          status: status || null, start_date, end_date, tantousha, memo: memo || null },
        { onConflict: 'project_number,machine,process_no' }
      );
    }
  } catch(e) { console.warn('保存エラー:', e); }
}

async function saveLinkedRecord(taskId, { start_date, end_date, owner, status }) {
  if (!taskId) return;
  try {
    await sb.from('tasks').update({
      start_date: start_date || null,
      end_date:   end_date   || null,
      owner:      owner      || null,
      is_completed: status === '完了',
    }).eq('id', taskId);
  } catch(e) { console.warn('連携保存エラー:', e); }
}

function editLinkedStatusCell(td, dateTd, proj, proc) {
  closeActiveInlineEdit();
  const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
  const linkedData = currentLinkedMap[lk] || {};
  const origHTML = td.innerHTML;

  td.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  [['', '─'], ['作業中', '作業中'], ['完了', '完了'], ['対象外', '対象外']].forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  });
  sel.value = linkedData.status || '';
  td.appendChild(sel);
  sel.focus();

  const cancel = () => { td.innerHTML = origHTML; };
  activeInlineEdit = { cancel };

  sel.addEventListener('change', async () => {
    const newStatus = sel.value;
    activeInlineEdit = null;
    td.innerHTML = '';
    const newSpan = document.createElement('span');
    newSpan.className = 'status-label';
    applyStatusStyle(dateTd, td, newSpan, newStatus);
    td.appendChild(newSpan);
    const cur = currentLinkedMap[lk] || {};
    await saveLinkedRecord(cur.id, { start_date: cur.start_date, end_date: cur.end_date, owner: cur.owner, status: newStatus });
    currentLinkedMap[lk] = { ...cur, status: newStatus };
  });

  sel.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineEdit && activeInlineEdit.cancel === cancel) {
        cancel(); activeInlineEdit = null;
      }
    }, 100);
  });
}

function editLinkedOwnerCell(td, proj, proc) {
  closeActiveInlineEdit();
  const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
  const linkedData = currentLinkedMap[lk] || {};
  const origHTML = td.innerHTML;

  td.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  const emptyO = document.createElement('option');
  emptyO.value = ''; emptyO.textContent = '─';
  sel.appendChild(emptyO);
  (PROCESS_OWNERS[proc.no] || []).forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
  sel.value = linkedData.owner || '';
  td.appendChild(sel);
  sel.focus();

  const cancel = () => { td.innerHTML = origHTML; };
  activeInlineEdit = { cancel };

  sel.addEventListener('change', async () => {
    const newOwner = sel.value;
    activeInlineEdit = null;
    td.innerHTML = '';
    const newSpan = document.createElement('span');
    newSpan.textContent = newOwner;
    td.appendChild(newSpan);
    const cur = currentLinkedMap[lk] || {};
    await saveLinkedRecord(cur.id, { start_date: cur.start_date, end_date: cur.end_date, owner: newOwner, status: cur.status });
    currentLinkedMap[lk] = { ...cur, owner: newOwner };
  });

  sel.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineEdit && activeInlineEdit.cancel === cancel) {
        cancel(); activeInlineEdit = null;
      }
    }, 100);
  });
}

function editLinkedDateCell(td, proj, proc) {
  closeActiveInlineEdit();
  ensureDatePicker();
  const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
  const linkedData = currentLinkedMap[lk] || {};

  const rect = td.getBoundingClientRect();
  const label = document.getElementById('fp-range-label');
  const anchor = document.getElementById('fp-anchor');
  anchor.style.top  = `${rect.top}px`;
  anchor.style.left = `${rect.right}px`;

  const posLabel = () => {
    const cal = document.querySelector('.flatpickr-calendar.open');
    if (cal) {
      const cr = cal.getBoundingClientRect();
      label.style.top  = `${cr.top - 22}px`;
      label.style.left = `${cr.left}px`;
      label.style.width = `${cr.width}px`;
    }
  };
  requestAnimationFrame(posLabel);

  datePickerSave = async (newStart, newEnd) => {
    td.textContent = fmtDate(newStart);
    const cur = currentLinkedMap[lk] || {};
    await saveLinkedRecord(cur.id, { start_date: newStart, end_date: newEnd, owner: cur.owner, status: cur.status });
    currentLinkedMap[lk] = { ...cur, start_date: newStart, end_date: newEnd };
  };

  const defaultDates = [linkedData.start_date, linkedData.end_date].filter(Boolean);
  datePicker.setDate(defaultDates, false);
  const initLabel = defaultDates.length === 2
    ? `開始日: ${defaultDates[0]}　終了日: ${defaultDates[1]}`
    : defaultDates.length === 1 ? `開始日: ${defaultDates[0]}　終了日: 未設定` : '開始日と終了日を選択してください';
  label.textContent = initLabel;

  datePicker.open();
  activeInlineEdit = { cancel: () => { datePickerSave = null; datePicker.close(); } };
}

function editLinkedDetailDateCell(tdStart, tdEnd, proj, proc) {
  closeActiveInlineEdit();
  ensureDatePicker();
  const lk = `${proj.project_number}__${proj.machine}__${proc.taskText}`;
  const linkedData = currentLinkedMap[lk] || {};

  const rect = tdStart.getBoundingClientRect();
  const label  = document.getElementById('fp-range-label');
  const anchor = document.getElementById('fp-anchor');
  anchor.style.top  = `${rect.top}px`;
  anchor.style.left = `${rect.right}px`;

  const posLabel = () => {
    const cal = document.querySelector('.flatpickr-calendar.open');
    if (cal) {
      const cr = cal.getBoundingClientRect();
      label.style.top   = `${cr.top - 22}px`;
      label.style.left  = `${cr.left}px`;
      label.style.width = `${cr.width}px`;
    }
  };
  requestAnimationFrame(posLabel);

  datePickerSave = async (newStart, newEnd) => {
    tdStart.textContent = fmtDate(newStart);
    tdEnd.textContent   = fmtDate(newEnd);
    const cur = currentLinkedMap[lk] || {};
    await saveLinkedRecord(cur.id, { start_date: newStart, end_date: newEnd, owner: cur.owner, status: cur.status });
    currentLinkedMap[lk] = { ...cur, start_date: newStart, end_date: newEnd };
  };

  const defaultDates = [linkedData.start_date, linkedData.end_date].filter(Boolean);
  datePicker.setDate(defaultDates, false);
  const initLabel = defaultDates.length === 2
    ? `開始日: ${defaultDates[0]}　終了日: ${defaultDates[1]}`
    : defaultDates.length === 1 ? `開始日: ${defaultDates[0]}　終了日: 未設定` : '開始日と終了日を選択してください';
  label.textContent = initLabel;

  datePicker.open();
  activeInlineEdit = { cancel: () => { datePickerSave = null; datePicker.close(); } };
}

function editDetailDateCell(tdStart, tdEnd, proj, proc) {
  closeActiveInlineEdit();
  ensureDatePicker();

  const key  = `${proj.project_number}__${proj.machine || ''}__${proc.no}`;
  const rec  = statusMap[key] || {};
  const rect = tdStart.getBoundingClientRect();
  const label  = document.getElementById('fp-range-label');
  const anchor = document.getElementById('fp-anchor');
  anchor.style.top  = `${rect.top}px`;
  anchor.style.left = `${rect.right}px`;

  const posLabel = () => {
    const cal = document.querySelector('.flatpickr-calendar.open');
    if (cal) {
      const cr = cal.getBoundingClientRect();
      label.style.top   = `${cr.top - 22}px`;
      label.style.left  = `${cr.left}px`;
      label.style.width = `${cr.width}px`;
    }
  };
  requestAnimationFrame(posLabel);

  datePickerSave = async (newStart, newEnd) => {
    tdStart.textContent = fmtDate(newStart);
    tdEnd.textContent   = fmtDate(newEnd);
    const curRec = statusMap[key] || {};
    await saveRecord(proj.project_number, proj.machine || '', proc.no, {
      status: curRec.status || null, start_date: newStart,
      end_date: newEnd, tantousha: curRec.tantousha || null,
      memo: curRec.memo || null,
    });
    const isEmpty = !curRec.status && !newStart && !newEnd && !curRec.tantousha && !curRec.memo;
    if (isEmpty) delete statusMap[key];
    else statusMap[key] = { ...curRec, start_date: newStart, end_date: newEnd };
  };

  const defaultDates = [rec.start_date, rec.end_date].filter(Boolean);
  datePicker.setDate(defaultDates, false);
  const initLabel = defaultDates.length === 2
    ? `開始日: ${defaultDates[0]}　終了日: ${defaultDates[1]}`
    : defaultDates.length === 1 ? `開始日: ${defaultDates[0]}　終了日: 未設定` : '開始日と終了日を選択してください';
  label.textContent = initLabel;

  datePicker.open();
  activeInlineEdit = { cancel: () => { datePickerSave = null; datePicker.close(); } };
}
