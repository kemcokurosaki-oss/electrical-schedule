const S_URL = "https://dgekjzkrybrswsxlcbvh.supabase.co";
const S_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnZWtqemtyeWJyc3dzeGxjYnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4ODQ3MjIsImV4cCI6MjA4NDQ2MDcyMn0.BsEj53lV3p76yE9fMPTaLn7ocKTNzYPTqIAnBafYItU";
const sb = supabase.createClient(S_URL, S_KEY);

// ─── 工程定義 ───────────────────────────────────────────
const PROCESSES = [
  { no:  1, name: '既設電気図面の入手',                           linked: false },
  { no:  2, name: 'リスト（モータ・電磁弁）出図',                 linked: false },
  { no:  3, name: '購入部品表（モータ・シリンダ）出図',           linked: false },
  { no:  4, name: '購入部品表（モータ・サーボ・インバータ等）出図', linked: false },
  { no:  5, name: 'エア回路図出図',                               linked: false },
  { no:  6, name: '油圧回路図出図',                               linked: false },
  { no:  7, name: '運転方案（センサ選定）',                       linked: false },
  { no:  8, name: '先行手配（PLC等）',                            linked: false },
  { no:  9, name: '機器リスト出図',                               linked: false },
  { no: 10, name: '機器リスト確認',                               linked: false },
  { no: 11, name: '操作盤外形図出図',                             linked: false },
  { no: 12, name: '操作盤外形図確認',                             linked: false },
  { no: 13, name: '電気図面出図',                                 linked: true,  taskText: '電気図面出図' },
  { no: 14, name: '部品手配',                                     linked: true,  taskText: '部品手配' },
  { no: 15, name: '確認用電気図出図（事前見積り用）',             linked: false },
  { no: 16, name: '確認用電気図確認',                             linked: false },
  { no: 17, name: '最終電気図出図',                               linked: true,  taskText: '最終電気図面' },
  { no: 18, name: '部品（板金含む）入荷',                         linked: false },
  { no: 19, name: '電気艤装開始日',                               linked: true,  taskText: '電気艤装' },
  { no: 20, name: '盤組開始日',                                   linked: true,  taskText: '盤組立' },
  { no: 21, name: '盤立ち上げ',                                   linked: false },
  { no: 22, name: '試運転開始日',                                 linked: true,  taskText: '試運転' },
];

// ─── 担当者マスター ─────────────────────────────────────
const DEPT_OWNERS = {
  営業: ['専務', '銭', '麻生', '原田', '岡本', '津村', '前川', '池田', '展久'],
  設計: ['藤山', '田中(善)', '安岡', '川邊', '檀', '堀井', '宮﨑', '津田', '古村', '柴田', '橋本', '松本(英)'],
  電技: ['松本(幹)', '秋藤'],
  操業: ['堀尾', '黒見', '大西(元)', '大西(優)', '木本', '前田', '本郷', '大重', '外注'],
  電装: ['木村(至)', '木村(圭)', '守時', '外注'],
};
const ALL_OWNERS = [
  ...DEPT_OWNERS.営業, ...DEPT_OWNERS.設計, ...DEPT_OWNERS.電技,
  ...DEPT_OWNERS.操業, ...DEPT_OWNERS.電装,
];
const PROCESS_OWNERS = {
   1: DEPT_OWNERS.営業,
   2: DEPT_OWNERS.設計,  3: DEPT_OWNERS.設計,
   4: DEPT_OWNERS.電技,
   5: DEPT_OWNERS.設計,  6: DEPT_OWNERS.設計,
   7: ALL_OWNERS,
   8: DEPT_OWNERS.電技,  9: DEPT_OWNERS.電技,
  10: DEPT_OWNERS.設計,
  11: DEPT_OWNERS.電技,
  12: DEPT_OWNERS.操業,
  13: DEPT_OWNERS.電技, 14: DEPT_OWNERS.電技, 15: DEPT_OWNERS.電技,
  16: DEPT_OWNERS.電装,
  17: DEPT_OWNERS.電技, 18: DEPT_OWNERS.電技,
  19: DEPT_OWNERS.電装, 20: DEPT_OWNERS.電装,
  21: DEPT_OWNERS.操業, 22: DEPT_OWNERS.操業,
};

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
  21: 'S',      22: 'A',
};
