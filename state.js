// ─── モジュールレベルの状態 ──────────────────────────────
let statusMap = {};        // 電気工程表の入力（denki_process_status）。キーは procKey
let linkedMap = {};        // 連携工程の全体工程表タスク。キーは procKey
let shipMap = {};          // 列ごとの工場出荷タスク。キーは `${工番}__${機種}`
let currentProjects = [];  // 表示する列（denki_columns の工番＋機種）
let editCtx = null;
let activeInlineEdit = null;
let ganttInitialized = false;
let datePicker = null;
let datePickerSave = null;
let canEdit = false;       // ログイン中の人が編集できるか（EDITORS で判定）

let currentDetailProjNum = null;
