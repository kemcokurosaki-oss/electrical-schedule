const S_URL = "https://dgekjzkrybrswsxlcbvh.supabase.co";
const S_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZWtqemtyeWJyc3dzeGxjYnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4ODQ3MjIsImV4cCI6MjA4NDQ2MDcyMn0.BsEj53lV3p76yE9fMPTaLn7ocKTNzYPTqIAnBafYItU";
const sb = supabase.createClient(S_URL, S_KEY);
// 編集できる人（DB の is_core_admin と同じ）。それ以外の人は閲覧のみ
const EDITORS = ['e-kurosaki@kusakabe.com', 's-morimura@kusakabe.com', 'm2-kusakabe@kusakabe.com']; // 黒崎・森村・常務
M365Login.init(sb, { appName: '電気工程表', mountAfter: '#nav-user-anchor',
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

// ─── 工程表の工程 → 完了までに必要なタスクリストの項目 ─────
// ガントの工程名に match の文字が含まれていれば、その工程の項目とみなす（上から順に判定）。
// 該当の項目がすべて「完了」になると、ガントの「タスク」欄に「完了可」を出す（工程表の完了は自動では付けない）
// ※ 仮の組み合わせ。検討結果に合わせてここを書き換える
const PROCESS_MAP = [
  { match: '操作盤外形図', nos: [11, 12] },
  { match: '電気図面',     nos: [9, 10, 13, 15, 16, 17] },
  { match: '電気品',       nos: [8, 14, 18] },
  { match: '盤組立',       nos: [20, 21] },
  { match: '電気艤装',     nos: [19] },
  { match: '試運転',       nos: [22] },
];
function processMapOf(text) {
  const s = String(text || '');
  return PROCESS_MAP.find(m => s.includes(m.match)) || null;
}
// タスクリストの項目 → どの工程のための項目か（タスクリストの「工程表の工程」列）
const PROCESS_KOTEI = {};
PROCESS_MAP.forEach(m => m.nos.forEach(n => { if (!PROCESS_KOTEI[n]) PROCESS_KOTEI[n] = m.match; }));

// ─── 遅れ・注意 ─────────────────────────────────────────
// 遅れ: 終了日を過ぎていて未完了。注意: 終了日まで WARN_DAYS 日以内で未完了
const WARN_DAYS = 3;

// ─── ガントチャートに出す全体工程表のタスク ─────────────
// 全体工程表では大項目の付け方がばらばら（例: 電気品手配が「操業」、電気品納期が「製管」）なので、
// 大項目・見出し・タスク名のどれかで電気関係とわかれば拾う
const GANTT_MAJOR_ITEMS = ['電技', '電装'];
const GANTT_PARENTS = ['電気設計＆電気品手配', '盤製作'];
const GANTT_TEXT_KEYWORDS = ['電気図面', '電気品', '盤組立', '電気艤装', '出荷準備(電装', '出荷準備（電装', '操作盤外形図'];
const GANTT_EXTRA_TEXTS = ['試運転', '工場出荷'];

function isElectricalTask(t) {
  const text = String(t.text || '').trim();
  if (!text || text.startsWith('現地')) return false; // 現地工事・現地試運転は別扱い
  const major = String(t.major_item || '').trim();
  // 「客先承認」は計画図の承認（大項目＝設計）と電気図面の承認があるので、設計のものは除く
  if (text === '客先承認') return major !== '設計' && major !== '';
  return GANTT_MAJOR_ITEMS.includes(major)
    || GANTT_PARENTS.includes(String(t.parent || '').trim())
    || GANTT_EXTRA_TEXTS.includes(text)
    || GANTT_TEXT_KEYWORDS.some(k => text.includes(k));
}

// 帯の色（大項目ごと。電気関係なのに大項目が別の部署のものは、タスク名で判断。工場出荷は別の色）
const GANTT_BAR_CLASS = { '電技': 'denki', '電装': 'denso' };
function barClassOf(t) {
  const text = String(t.text || '');
  if (GANTT_BAR_CLASS[t.major_item]) return GANTT_BAR_CLASS[t.major_item];
  if (text.includes('試運転')) return 'sosou';
  if (/盤組立|電気艤装|電装/.test(text) || t.parent === '盤製作') return 'denso';
  return 'denki';
}
// 絞り込みの部署（帯の色の分け方と同じ）
const DEPT_FILTERS = [
  { key: 'denki', label: '電技' },
  { key: 'denso', label: '電装' },
  { key: 'sosou', label: '試運転' },
  { key: 'ship',  label: '工場出荷' },
];

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
