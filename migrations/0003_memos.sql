-- 案件メモ欄（エムネットの各案件の「チャット」に近いもの）。2026-11-24 追加（川﨑部長・画面案の案3）。
-- 会話ではなく、現品票・製作の必要事項・注意事項を書いておく場所。足すだけ（今の表は変えない）。
-- items の「ノウハウ」「備考」はエムネットのCSV取り込みで上書きされるので、別の表にして取り込みで消えないようにする。

-- この案件（品目）のメモ。書くたびに1行増える（今回だけの連絡・現品票など）。消しても行は残す（canceled_at）。
CREATE TABLE item_memos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,                   -- 品目ID
  kind TEXT NOT NULL DEFAULT '',           -- 種類（必要事項・注意・現品票・連絡）
  body TEXT NOT NULL DEFAULT '',           -- 中身
  created_at TEXT NOT NULL DEFAULT '',     -- 書いた日時（日本時間の文字）
  created_by TEXT NOT NULL DEFAULT '',     -- 書いた人（メール）
  created_name TEXT NOT NULL DEFAULT '',   -- 書いた人（名前）
  canceled_at TEXT NOT NULL DEFAULT '',    -- 消した日時（空＝出す）
  canceled_by TEXT NOT NULL DEFAULT '',    -- 消した人（メール）
  op_id TEXT NOT NULL DEFAULT ''           -- 操作の札（同じ書き込みが2回届いても1回分にする）
);
CREATE INDEX ix_memos_item ON item_memos(item_id);

-- 品番（図面番号）ごとの製作の注意。同じ図面番号の次の案件にも出る。
-- 直すたびに1行増やし、いちばん新しい行（rowid が最大）が今の注意。前の版はそのまま残る（だれが・いつ・どう直したか）。
CREATE TABLE drawing_notes (
  id TEXT PRIMARY KEY,
  drawing_no TEXT NOT NULL,                -- 図面番号（items.drawing_no と同じ書き方）
  body TEXT NOT NULL DEFAULT '',           -- 注意の中身（空＝注意なしに戻した）
  saved_at TEXT NOT NULL DEFAULT '',       -- 直した日時（日本時間の文字）
  saved_by TEXT NOT NULL DEFAULT '',       -- 直した人（メール）
  saved_name TEXT NOT NULL DEFAULT '',     -- 直した人（名前）
  op_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_dnotes_dwg ON drawing_notes(drawing_no);
