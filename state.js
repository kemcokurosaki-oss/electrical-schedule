// ─── モジュールレベルの状態 ──────────────────────────────
let statusMap = {};        // 電気工程表の入力（denki_process_status）。キーは procKey
let linkedMap = {};        // 連携項目の全体工程表タスク。キーは procKey
let shipMap = {};          // 列ごとの工場出荷日。キーは `${工番}__${機種}`
let currentProjects = [];  // 表示する列（denki_columns の工番＋機種）
let ganttInitialized = false;
let canEdit = false;       // ログイン中の人が編集できるか（EDITORS で判定）
