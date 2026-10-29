// ─── 保存 ─────────────────────────────────────────
// 1つのセル（列×工程）を保存する。patch は変更する項目だけ: { status, start_date, end_date, owner, memo }
// 連携工程（全体工程表のタスクがあるもの）は、日付・担当者・完了を tasks に、それ以外のステータスとメモを denki_process_status に保存する
async function saveProc(proj, proc, patch) {
  if (!canEdit) return false;
  const key = procKey(proj, proc);
  const cur = getProcData(proj, proc);
  const next = {
    status: cur.inputStatus, start_date: cur.start_date || null, end_date: cur.end_date || null,
    owner: cur.owner || '', memo: cur.memo || null,
    ...patch,
  };
  const pn = String(proj.project_number);

  try {
    let rec;
    if (cur.linked) {
      // 全体工程表のタスクは、変更した項目だけ書き換える
      const upd = {};
      if ('start_date' in patch) upd.start_date = next.start_date;
      if ('end_date' in patch)   upd.end_date   = next.end_date;
      if ('owner' in patch)      upd.owner      = next.owner || null;
      if ('status' in patch)     upd.is_completed = next.status === '完了';
      if (Object.keys(upd).length) {
        const { data, error } = await sb.from('tasks').update(upd).eq('id', cur.taskId).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('全体工程表のタスクを更新できませんでした（権限がないか、ログインが切れています）');
      }
      rec = { status: next.status === '完了' ? null : (next.status || null),
              start_date: null, end_date: null, tantousha: null, memo: next.memo || null };
    } else {
      rec = { status: next.status || null, start_date: next.start_date, end_date: next.end_date,
              tantousha: next.owner || null, memo: next.memo || null };
    }

    const isEmpty = !rec.status && !rec.start_date && !rec.end_date && !rec.tantousha && !rec.memo;
    if (isEmpty) {
      if (statusMap[key]) {
        const { data, error } = await sb.from('denki_process_status').delete()
          .eq('project_number', pn).eq('machine', proj.machine).eq('process_no', proc.no)
          .select('process_no');
        if (error) throw error;
        if (!data.length) throw new Error('削除できませんでした（権限がないか、ログインが切れています）');
        delete statusMap[key];
      }
    } else {
      const { error } = await sb.from('denki_process_status').upsert(
        { project_number: pn, machine: proj.machine, process_no: proc.no, ...rec },
        { onConflict: 'project_number,machine,process_no' }
      );
      if (error) throw error;
      statusMap[key] = rec;
    }

    if (cur.linked) {
      Object.assign(linkedMap[key], {
        start_date: next.start_date, end_date: next.end_date,
        owner: next.owner || '', completed: next.status === '完了',
      });
    }
    return true;
  } catch (e) {
    console.warn('保存エラー:', e);
    alert(`保存できませんでした。\n${e.message || e}\n\n画面を保存済みの内容に戻します。ログインが切れている場合は、ページを再読み込みしてください。`);
    await refreshDisplay();
    return false;
  }
}

// 保存後に表と詳細表示を描き直す
function rerenderViews() {
  renderTable(currentProjects);
  if (currentDetailProjNum) renderDetailTable(currentDetailProjNum);
}

// ─── インライン編集 ───────────────────────────────
function closeActiveInlineEdit() {
  if (!activeInlineEdit) return;
  activeInlineEdit.cancel();
  activeInlineEdit = null;
}

function fillStatusOptions(sel) {
  sel.innerHTML = '';
  ['', ...STATUS_LIST].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v || '─';
    sel.appendChild(o);
  });
}

function fillOwnerOptions(sel, procNo, current) {
  sel.innerHTML = '<option value="">─</option>';
  const names = [...(PROCESS_OWNERS[procNo] || [])];
  if (current && !names.includes(current)) names.unshift(current); // 全体工程表で候補外の名前が入っているとき
  names.forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
  sel.value = current || '';
}

// セルの中に select を出して、選んだら保存する
function editSelectCell(td, fill, onPick) {
  if (!canEdit) return;
  closeActiveInlineEdit();
  const origHTML = td.innerHTML;
  td.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'inline-select';
  fill(sel);
  td.appendChild(sel);
  sel.focus();

  const cancel = () => { td.innerHTML = origHTML; };
  activeInlineEdit = { cancel };

  sel.addEventListener('change', async () => {
    activeInlineEdit = null;
    sel.disabled = true;
    if (await onPick(sel.value)) rerenderViews();
  });
  sel.addEventListener('blur', () => {
    setTimeout(() => {
      if (activeInlineEdit && activeInlineEdit.cancel === cancel) {
        cancel(); activeInlineEdit = null;
      }
    }, 100);
  });
}

function editStatusCell(td, proj, proc) {
  editSelectCell(td,
    sel => { fillStatusOptions(sel); sel.value = getProcData(proj, proc).inputStatus; },
    v => saveProc(proj, proc, { status: v }));
}

function editOwnerCell(td, proj, proc) {
  editSelectCell(td,
    sel => fillOwnerOptions(sel, proc.no, getProcData(proj, proc).owner),
    v => saveProc(proj, proc, { owner: v }));
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

// 開始日・終了日をカレンダーで選んで保存する（表・詳細表示共通）
function editDateCell(td, proj, proc) {
  if (!canEdit) return;
  closeActiveInlineEdit();
  ensureDatePicker();

  const cur = getProcData(proj, proc);
  const rect = td.getBoundingClientRect();
  const label = document.getElementById('fp-range-label');
  const anchor = document.getElementById('fp-anchor');
  anchor.style.top  = `${rect.top}px`;
  anchor.style.left = `${rect.right}px`;

  requestAnimationFrame(() => {
    const cal = document.querySelector('.flatpickr-calendar.open');
    if (cal) {
      const cr = cal.getBoundingClientRect();
      label.style.top   = `${cr.top - 22}px`;
      label.style.left  = `${cr.left}px`;
      label.style.width = `${cr.width}px`;
    }
  });

  datePickerSave = async (newStart, newEnd) => {
    if (await saveProc(proj, proc, { start_date: newStart, end_date: newEnd })) rerenderViews();
  };

  const defaultDates = [cur.start_date, cur.end_date].filter(Boolean);
  datePicker.setDate(defaultDates, false);
  label.textContent = defaultDates.length === 2
    ? `開始日: ${defaultDates[0]}　終了日: ${defaultDates[1]}`
    : defaultDates.length === 1 ? `開始日: ${defaultDates[0]}　終了日: 未設定` : '開始日と終了日を選択してください';

  datePicker.open();
  activeInlineEdit = { cancel: () => { datePickerSave = null; datePicker.close(); } };
}
