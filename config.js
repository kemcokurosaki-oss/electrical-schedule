const S_URL = "https://dgekjzkrybrswsxlcbvh.supabase.co";
const S_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZWtqemtyeWJyc3dzeGxjYnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4ODQ3MjIsImV4cCI6MjA4NDQ2MDcyMn0.BsEj53lV3p76yE9fMPTaLn7ocKTNzYPTqIAnBafYItU";
const sb = supabase.createClient(S_URL, S_KEY);
// 編集できる人（DB の is_core_admin と同じ）。それ以外の人は閲覧のみ
const EDITORS = ['e-kurosaki@kusakabe.com', 's-morimura@kusakabe.com', 'm2-kusakabe@kusakabe.com']; // 黒崎・森村・常務
M365Login.init(sb, { appName: '電気工程表', mountAfter: '#btn-manage',
  canEdit: (email) => EDITORS.includes(email.toLowerCase()) });

// ─── 工程定義 ───────────────────────────────────────────
const PROCESSES = [
  { no:  1, name: '既設電気図面の入手' },
  { no:  2, name: 'リスト（モータ・電磁弁）出図' },
  { no:  3, name: '購入部品表（モータ・シリンダ）出図' },
  { no:  4, name: '購入部品表（モータ・サーボ・インバータ等）出図' },
  { no:  5, name: 'エア回路図出図' },
  { no:  6, name: '油圧回路図出図' },
  { no:  7, name: '運転方案（センサ選定）' },
  { no:  8, name: '先行手配（PLC等）' },
  { no:  9, name: '機器リスト出図' },
  { no: 10, name: '機器リスト確認' },
  { no: 11, name: '操作盤外形図出図' },
  { no: 12, name: '操作盤外形図確認' },
  { no: 13, name: '電気図面出図' },
  { no: 14, name: '部品手配' },
  { no: 15, name: '確認用電気図出図（事前見積り用）' },
  { no: 16, name: '確認用電気図確認' },
  { no: 17, name: '最終電気図出図' },
  { no: 18, name: '部品（板金含む）入荷' },
  { no: 19, name: '電気艤装開始日' },
  { no: 20, name: '盤組開始日' },
  { no: 21, name: '盤立ち上げ' },
  { no: 22, name: '試運転開始日' },
];
// タスクリストの項目（最初の版。将来は画面から編集できるよう DB に移す予定。no は保存データのキーなので変えない）
// タスクリストは工程（ガントの帯）の中の細かいやること。全体工程表とは連携せず、電気工程表だけに保存する

// ─── ガントチャートに出す全体工程表のタスク ─────────────
// 大項目（major_item）が電技・電装のタスクすべて＋下のタスク名。ただし「現地」で始まる工程（現地工事・現地試運転）は別扱いのため出さない
const GANTT_MAJOR_ITEMS = ['電技', '電装'];
const GANTT_EXTRA_TEXTS = ['試運転', '工場出荷'];
// 帯の色（大項目ごと。工場出荷は別の色）
const GANTT_BAR_CLASS = { '電技': 'denki', '電装': 'denso', '操業': 'sosou' };

// ─── ステータス ─────────────────────────────────────────
const STATUS_LIST = ['作業中', '確認依頼中', '手配中', '完了', '対象外', '未'];

// ─── 部署→クラス名マッピング ────────────────────────────
const PROCESS_DEPT = {
   1: 'eigyo',
   2: 'sekkei',  3: 'sekkei',  5: 'sekkei',  6: 'sekkei', 10: 'sekkei',
   4: 'denki',   8: 'denki',   9: 'denki',  11: 'denki',
  13: 'denki',  14: 'denki',  15: 'denki',  17: 'denki',  18: 'denki',
  12: 'sosou',  21: 'sosou',  22: 'sosou',
  16: 'denso',  19: 'denso',  20: 'denso',
};

// ─── 工程フロー ─────────────────────────────────────────
const PROCESS_FLOW = {
   1: '営業→E',   2: 'M→E',      3: 'M→E',    4: 'E→資材',
   5: 'M→E',     6: 'M→E',      7: '全部署',   8: 'E→代理店',
   9: 'E→M',    10: 'M→E',     11: 'E→S',   12: 'S→E',
  13: 'E→客先', 14: 'E→代理店', 15: 'E→A',   16: 'A→E',
  17: 'E→A',   18: 'E',        20: 'A',
  21: 'S',      22: 'S',
};
