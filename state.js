// ─── モジュールレベルの状態 ──────────────────────────────
let statusMap = {};        // 電気工程表の入力（denki_process_status）。キーは procKey
let ganttTasks = {};       // 列ごとの全体工程表の電気関係タスク（ガントの帯）。キーは `${工番}__${機種}`
let ganttOther = {};       // どの列の機種にも合わない電気関係タスク（機種が空欄など）。キーは工番
let currentProjects = [];  // 表示する列（denki_columns の工番＋機種）
let ganttInitialized = false;
let canEdit = false;       // ログイン中の人が編集できるか（EDITORS で判定）
let myName = '';           // ログイン中の人の名前（「自分の担当」の絞り込みで、全体工程表の担当者と照合する）
let selectedPn = null;     // 左メニュー・議事録欄で選んでいる工番
let taskStats = { late: 0, soon: 0, latePns: new Set(), soonPns: new Set() }; // 遅れ・注意の件数
