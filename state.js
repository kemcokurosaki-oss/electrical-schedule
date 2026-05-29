// ─── モジュールレベルの状態 ──────────────────────────────
let statusMap = {};
let currentProjects = [];
let currentLinkedMap = {};
let editCtx = null;
let activeInlineEdit = null;
let ganttInitialized = false;
let datePicker = null;
let datePickerSave = null;

let visibleProjectNums = new Set();
let allAvailableProjects = [];
let currentDetailProjNum = null;
