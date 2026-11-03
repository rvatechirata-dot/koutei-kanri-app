-- 工程管理アプリ（koutei-kanri-app）の表。2026-11-03 作成。
-- 元＝川﨑課長の試作「工程管理（エムネット置き換え 試作①）」7段目c（Apps Script＋スプレッドシート・画面の版0.7.2）。
-- 試作のシート12枚を、同じ意味の表にした（データをそのまま移せるように。列の対応は docs/仕様書.md）。
--
-- ■ 日時の持ち方（このアプリだけの決まり）
--   日時はすべて「日本時間の文字」で持つ：日時＝'YYYY/MM/DD HH:MM'、日付＝'YYYY/MM/DD'。
--   エムネットのCSV・試作のデータが日本時間の文字なので、そのまま比べられるようにした。
--   datetime('now')（UTC）は使わない。今の時刻はアプリ側の src/lib/kotei/time.ts の nowJst() で入れる。
--   （目視 可動率アプリと同じく「最初から日本時間」型。表示のとき jst.ts で9時間足さないこと）
-- ■ 数（数量・単価など）も、エムネットのCSVと同じ文字で持つ（「10」と「10.0」の違いを取り込みで正しく比べるため）。
--   足し算するときは CAST(... AS REAL)。
-- ■ IDは試作と同じ文字のID（A000001・Iw… など）。外部キーの制約は付けない（試作と同じ。消した品目の記録も残す）。

-- 案件（受注1件。社内管理番号ごと）
CREATE TABLE cases (
  id TEXT PRIMARY KEY,           -- 案件ID
  mgmt_no TEXT NOT NULL DEFAULT '', -- 社内管理番号（案件の見分け）
  sales_rep TEXT NOT NULL DEFAULT '',      -- 営業担当
  customer_po TEXT NOT NULL DEFAULT '',    -- 顧客発注番号
  customer TEXT NOT NULL DEFAULT '',       -- 顧客
  customer_contact TEXT NOT NULL DEFAULT '', -- 顧客の担当者
  order_date TEXT NOT NULL DEFAULT '',     -- 受注日
  bulk_due TEXT NOT NULL DEFAULT '',       -- 一括納期
  link TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',           -- 備考
  annotation TEXT NOT NULL DEFAULT '',     -- 注釈
  hidden TEXT NOT NULL DEFAULT '',         -- 隠す（'1'）
  updated_at TEXT NOT NULL DEFAULT '',     -- 最後に直した日時
  updated_by TEXT NOT NULL DEFAULT ''      -- 直した人（メール）
);
CREATE INDEX ix_cases_mgmt ON cases(mgmt_no);

-- 品目（案件の中の製品1種。エムネットの案件一覧CSVの1行）
CREATE TABLE items (
  id TEXT PRIMARY KEY,           -- 品目ID
  case_id TEXT NOT NULL,         -- 案件ID
  barcode TEXT NOT NULL,         -- バーコード番号（13桁。エムネットと突き合わせるキー）
  kubun TEXT NOT NULL DEFAULT '',          -- 区分（量産品・試作・在庫管理 など）
  kubun2 TEXT NOT NULL DEFAULT '',         -- 区分2（製造技術）
  ext_barcode TEXT NOT NULL DEFAULT '',    -- 社外バーコード
  drawing_no TEXT NOT NULL DEFAULT '',     -- 図面番号（在庫の単位）
  name TEXT NOT NULL DEFAULT '',           -- 品名
  unit_price TEXT NOT NULL DEFAULT '',     -- 単価（社外に出さない）
  qty TEXT NOT NULL DEFAULT '',            -- 数量
  final_due TEXT NOT NULL DEFAULT '',      -- 最終納期
  link TEXT NOT NULL DEFAULT '',
  knowhow TEXT NOT NULL DEFAULT '',        -- ノウハウ
  note TEXT NOT NULL DEFAULT '',           -- 備考
  hidden TEXT NOT NULL DEFAULT '',         -- 隠す（'1'）
  delivery_json TEXT NOT NULL DEFAULT '',  -- 納品情報（エムネットのお届け情報 最大5件のJSON）
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT ''          -- 登録元（空＝エムネットから／'この画面'＝画面で登録）
);
CREATE UNIQUE INDEX ux_items_barcode ON items(barcode);
CREATE INDEX ix_items_case ON items(case_id);

-- 工程（品目の中の工程1つ）。状態の列は持たない（開始日時・完了日時から決める）
CREATE TABLE processes (
  id TEXT PRIMARY KEY,           -- 工程ID
  item_id TEXT NOT NULL,         -- 品目ID
  seq TEXT NOT NULL DEFAULT '',  -- 順番（1から）
  in_out TEXT NOT NULL DEFAULT '',         -- 社内外注（'社内'／'外注'）
  mnet_slot TEXT NOT NULL DEFAULT '',      -- エムネットの枠（社内1・外注1…。取り込みで同じ工程を突き合わせる）
  name TEXT NOT NULL DEFAULT '',           -- 工程名
  assignee TEXT NOT NULL DEFAULT '',       -- 担当者・外注先
  machine TEXT NOT NULL DEFAULT '',        -- 機械
  plan_start TEXT NOT NULL DEFAULT '',     -- 開始予定
  due TEXT NOT NULL DEFAULT '',            -- 納期
  started_at TEXT NOT NULL DEFAULT '',     -- 開始日時
  done_at TEXT NOT NULL DEFAULT '',        -- 完了日時
  done_qty TEXT NOT NULL DEFAULT '',       -- 完成数量（良品）
  inspected_on TEXT NOT NULL DEFAULT '',   -- 検査日
  inspector TEXT NOT NULL DEFAULT '',      -- 検査者
  unit_price TEXT NOT NULL DEFAULT '',     -- 工程単価
  std_time TEXT NOT NULL DEFAULT '',       -- 基準時間
  note TEXT NOT NULL DEFAULT '',           -- 備考
  extra_json TEXT NOT NULL DEFAULT '',     -- その他（外注の発注期限・材料など。JSON）
  started_by TEXT NOT NULL DEFAULT '',     -- 開始した人（この画面で押した人）
  done_by TEXT NOT NULL DEFAULT '',        -- 完了した人
  defect_qty TEXT NOT NULL DEFAULT '',     -- 不良数
  comment TEXT NOT NULL DEFAULT '',        -- コメント
  defect_reason TEXT NOT NULL DEFAULT ''   -- 不良の理由
);
CREATE INDEX ix_proc_item ON processes(item_id);

-- 作業（工程の中の作業1回。取り消しても行は残す）
CREATE TABLE works (
  id TEXT PRIMARY KEY,           -- 作業ID
  item_id TEXT NOT NULL DEFAULT '',
  process_id TEXT NOT NULL DEFAULT '',
  worker TEXT NOT NULL DEFAULT '',         -- 作業者
  started_at TEXT NOT NULL DEFAULT '',
  ended_at TEXT NOT NULL DEFAULT '',       -- 空＝作業中
  good_qty TEXT NOT NULL DEFAULT '',       -- 完成数（良品）
  defect_qty TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT '',     -- もと（エムネットの作業ログから写した行の印）
  recorded_at TEXT NOT NULL DEFAULT '',    -- 記録した日時
  account TEXT NOT NULL DEFAULT '',        -- アカウント（メール）
  canceled_at TEXT NOT NULL DEFAULT '',    -- 取り消した日時
  canceled_by TEXT NOT NULL DEFAULT '',
  op_id TEXT NOT NULL DEFAULT '',          -- 操作の札
  machine TEXT NOT NULL DEFAULT '',
  defect_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_works_proc ON works(process_id);

-- 実績記録（画面で押した操作の履歴。消さずに増える）
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT '',             -- 日時（押した時）
  recorded_at TEXT NOT NULL DEFAULT '',    -- 記録した日時
  account TEXT NOT NULL DEFAULT '',
  worker TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  process_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',         -- 操作（開始・完了・出荷 など）
  qty TEXT NOT NULL DEFAULT '',            -- 完成数量
  prev_started_at TEXT NOT NULL DEFAULT '',
  prev_done_at TEXT NOT NULL DEFAULT '',
  op_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''          -- 内容
);
CREATE INDEX ix_alog_item ON action_log(item_id);

-- 出荷（出荷1回＝1行。分納は何行でも。取り消しても行は残す）
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,           -- 出荷ID
  item_id TEXT NOT NULL DEFAULT '',
  process_id TEXT NOT NULL DEFAULT '',
  ship_date TEXT NOT NULL DEFAULT '',      -- 出荷日
  qty TEXT NOT NULL DEFAULT '',
  dest TEXT NOT NULL DEFAULT '',           -- お届け先
  contact TEXT NOT NULL DEFAULT '',        -- 担当者
  packages TEXT NOT NULL DEFAULT '',       -- 荷物の個数
  carrier TEXT NOT NULL DEFAULT '',        -- 配送業者
  slip_no TEXT NOT NULL DEFAULT '',        -- 伝票番号
  time_spec TEXT NOT NULL DEFAULT '',      -- 時間指定
  note TEXT NOT NULL DEFAULT '',
  from_stock TEXT NOT NULL DEFAULT '',     -- 在庫から（'1'）
  recorded_at TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  worker TEXT NOT NULL DEFAULT '',
  canceled_at TEXT NOT NULL DEFAULT '',
  canceled_by TEXT NOT NULL DEFAULT '',
  op_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_ship_item ON shipments(item_id);

-- 在庫の動き（製品の数の＋／－1回＝1行。数はこれを足して出す）
CREATE TABLE stock_moves (
  id TEXT PRIMARY KEY,           -- 動きID
  at TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  worker TEXT NOT NULL DEFAULT '',
  drawing_no TEXT NOT NULL DEFAULT '',     -- 図面番号
  qty TEXT NOT NULL DEFAULT '',            -- 数（＋／－）
  kind TEXT NOT NULL DEFAULT '',           -- 種類
  book TEXT NOT NULL DEFAULT '',           -- 帳簿（'エムネット'／'画面'）
  item_id TEXT NOT NULL DEFAULT '',
  process_id TEXT NOT NULL DEFAULT '',
  shipment_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  op_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL DEFAULT ''      -- もと
);
CREATE INDEX ix_mv_dw ON stock_moves(drawing_no);

-- 基本の一覧（名寄せ：工程名・作業者・機械・外注先・顧客・不良の理由）
CREATE TABLE masters (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT '',           -- 種類
  name TEXT NOT NULL DEFAULT '',           -- 名前（正しい書き方）
  aliases TEXT NOT NULL DEFAULT '',        -- 別の書き方（「｜」区切り）
  sort_order TEXT NOT NULL DEFAULT '',     -- 並び
  unused TEXT NOT NULL DEFAULT '',         -- 使わない（'1'）
  memo TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

-- 休日（土日のほかの休み）
CREATE TABLE holidays (
  date TEXT PRIMARY KEY,         -- 'YYYY/MM/DD'
  memo TEXT NOT NULL DEFAULT ''
);

-- 設定（ver＝更新番号・next_no＝次の番号・next_barcode＝次のバーコード・stock_main＝在庫の正）
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
INSERT INTO settings (key, value) VALUES ('ver', '1'), ('next_no', '1'), ('next_barcode', '1'), ('stock_main', 'エムネット');

-- 取り込み履歴（CSV取り込み1回）
CREATE TABLE import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  added INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  op_id TEXT NOT NULL DEFAULT ''
);

-- ごみ箱（消した品目1つ＝1行。中身は案件・品目・工程の行をJSONで丸ごと）
CREATE TABLE trash (
  id TEXT PRIMARY KEY,
  bundle TEXT NOT NULL DEFAULT '',         -- 束（いっしょに消したまとまり）
  kind TEXT NOT NULL DEFAULT '',           -- 種類（取り込みで消した／品目を消した／案件を消した）
  case_id TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',          -- 見出し（社内管理番号 図面番号 品名）
  deleted_at TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT ''
);

-- 操作ログ（誰がいつ何をしたか。アプリ開発ルールの「全アプリに入れる」）。閲覧は記録しない
CREATE TABLE operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT '',   -- 日本時間 'YYYY/MM/DD HH:MM'（このアプリの決まり）
  actor TEXT,                    -- 実行者（Cloudflare Access のメール）
  action TEXT NOT NULL,          -- import / migrate など
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT
);
CREATE INDEX ix_oplog_at ON operation_logs(id DESC);
