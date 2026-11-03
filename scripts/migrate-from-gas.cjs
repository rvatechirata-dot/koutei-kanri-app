// 川﨑課長の試作（Apps Script＋スプレッドシート「工程管理_データ」）のデータを、このアプリの表に移すSQLを作る。
// 2026-11-04 作成（平田さん「移す」決定 2026-11-03）。
//
// 使い方：
//   node scripts/migrate-from-gas.cjs <シートを書き出したJSON> <出力するSQL>
//   npx wrangler d1 execute koutei-kanri-db --local --file <出力するSQL>
// JSON の形：{ fetchedAt, sheets: { 案件: "CSVの文字", 品目: "...", ... } }（シートごとに見出し1行＋データ）。
//   スプレッドシートを開いたブラウザで gviz/tq?tqx=out:csv&headers=1&sheet=<名前> を読んだもの。
// ⚠ JSON と SQL には客先名・単価が入る。リポジトリ（このフォルダ）に置かない。
//
// 試作の日時は日本時間の文字（'YYYY/MM/DD HH:MM'）で、このアプリと同じ形なので、そのまま入れる。
// 出力するSQLは、案件などの表を空にしてから入れ直す（何度流しても同じ結果。手元の試しに使う）。
// 本番に流すのは最初の1回だけ（そのあと取り込み・現場の入力でデータが育つので、流し直すと消える）。
const fs = require("node:fs");

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error("使い方: node scripts/migrate-from-gas.cjs <JSON> <出力SQL>");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let r = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      r.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      r.push(f);
      rows.push(r);
      r = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || r.length) {
    r.push(f);
    rows.push(r);
  }
  return rows.filter((x) => x.some((v) => v !== ""));
}

// シート → [表, { 見出し: 列 }]。表に無い列（受け皿の無い見出し）があれば止める
const MAP = {
  案件: ["cases", { 案件ID: "id", 社内管理番号: "mgmt_no", 営業担当: "sales_rep", 顧客発注番号: "customer_po", 顧客: "customer", 顧客の担当者: "customer_contact", 受注日: "order_date", 一括納期: "bulk_due", リンク: "link", 備考: "note", 注釈: "annotation", 隠す: "hidden", 最後に直した日時: "updated_at", 直した人: "updated_by" }],
  品目: ["items", { 品目ID: "id", 案件ID: "case_id", バーコード番号: "barcode", 区分: "kubun", 区分2: "kubun2", 社外バーコード: "ext_barcode", 図面番号: "drawing_no", 品名: "name", 単価: "unit_price", 数量: "qty", 最終納期: "final_due", リンク: "link", ノウハウ: "knowhow", 備考: "note", 隠す: "hidden", 納品情報: "delivery_json", 最後に直した日時: "updated_at", 直した人: "updated_by", 登録元: "source" }],
  工程: ["processes", { 工程ID: "id", 品目ID: "item_id", 順番: "seq", 社内外注: "in_out", エムネットの枠: "mnet_slot", 工程名: "name", "担当者・外注先": "assignee", 機械: "machine", 開始予定: "plan_start", 納期: "due", 開始日時: "started_at", 完了日時: "done_at", 完成数量: "done_qty", 検査日: "inspected_on", 検査者: "inspector", 工程単価: "unit_price", 基準時間: "std_time", 備考: "note", その他: "extra_json", 開始した人: "started_by", 完了した人: "done_by", 不良数: "defect_qty", コメント: "comment", 不良の理由: "defect_reason" }],
  作業: ["works", { 作業ID: "id", 品目ID: "item_id", 工程ID: "process_id", 作業者: "worker", 開始日時: "started_at", 終了日時: "ended_at", 完成数: "good_qty", 不良数: "defect_qty", コメント: "comment", もと: "source_key", 記録した日時: "recorded_at", アカウント: "account", 取り消した日時: "canceled_at", 取り消した人: "canceled_by", 操作の札: "op_id", 機械: "machine", 不良の理由: "defect_reason" }],
  実績記録: ["action_log", { 日時: "at", 記録した日時: "recorded_at", アカウント: "account", 作業者: "worker", 品目ID: "item_id", 工程ID: "process_id", 操作: "action", 完成数量: "qty", 前の開始日時: "prev_started_at", 前の完了日時: "prev_done_at", 操作の札: "op_id", 内容: "detail" }],
  出荷: ["shipments", { 出荷ID: "id", 品目ID: "item_id", 工程ID: "process_id", 出荷日: "ship_date", 数量: "qty", お届け先: "dest", 担当者: "contact", 荷物の個数: "packages", 配送業者: "carrier", 伝票番号: "slip_no", 時間指定: "time_spec", 備考: "note", 在庫から: "from_stock", 記録した日時: "recorded_at", アカウント: "account", 作業者: "worker", 取り消した日時: "canceled_at", 取り消した人: "canceled_by", 操作の札: "op_id" }],
  在庫の動き: ["stock_moves", { 動きID: "id", 日時: "at", 記録した日時: "recorded_at", アカウント: "account", 作業者: "worker", 図面番号: "drawing_no", 数: "qty", 種類: "kind", 帳簿: "book", 品目ID: "item_id", 工程ID: "process_id", 出荷ID: "shipment_id", 内容: "detail", 操作の札: "op_id", もと: "source_key" }],
  基本の一覧: ["masters", { ID: "id", 種類: "kind", 名前: "name", 別の書き方: "aliases", 並び: "sort_order", 使わない: "unused", メモ: "memo", 最後に直した日時: "updated_at", 直した人: "updated_by" }],
  休日: ["holidays", { 日付: "date", メモ: "memo" }],
  取り込み履歴: ["import_history", { 日時: "at", 人: "account", ファイル: "file", 新しい: "added", 変わった: "changed", 消した: "deleted", 操作の札: "op_id" }],
  // ごみ箱の「中身」は試作のシートの行（見出しの並びの配列）のJSONのまま。戻す機能を作るときに読み替える
  ごみ箱: ["trash", { ごみ箱ID: "id", 束: "bundle", 種類: "kind", 案件ID: "case_id", 品目ID: "item_id", 見出し: "title", 消した日時: "deleted_at", 消した人: "deleted_by", 中身: "content_json" }],
};
const INT_COLS = new Set(["added", "changed", "deleted"]);
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

const data = JSON.parse(fs.readFileSync(src, "utf8"));
const sql = [`-- 試作のデータを移す（${data.fetchedAt} に読んだもの）`];
const counts = {};
// 子から先に空にする（外部キーは無いが、読みやすさのため）
for (const [, [table]] of Object.entries(MAP).reverse()) sql.push(`DELETE FROM ${table};`);
for (const [sheet, [table, cols]] of Object.entries(MAP)) {
  const text = data.sheets[sheet];
  if (typeof text !== "string" || text.startsWith("<")) throw new Error(`シート「${sheet}」が読めていません`);
  const rows = parseCsv(text);
  const head = rows[0] || [];
  const unknown = head.filter((h) => h && !(h in cols));
  if (unknown.length) throw new Error(`シート「${sheet}」に受け皿の無い見出し：${unknown.join("・")}`);
  const use = head.map((h) => cols[h]).filter(Boolean);
  const idx = head.map((h, i) => (cols[h] ? i : -1)).filter((i) => i >= 0);
  counts[sheet] = rows.length - 1;
  for (const r of rows.slice(1)) {
    const vals = idx.map((i, k) => (INT_COLS.has(use[k]) ? String(Number(r[i]) || 0) : q(r[i] ?? "")));
    sql.push(`INSERT INTO ${table} (${use.join(", ")}) VALUES (${vals.join(", ")});`);
  }
}
// 設定：次の番号・次のバーコード・在庫の正は試作の値を引き継ぐ（同じ番号を二度使わないため）
const set = Object.fromEntries(parseCsv(data.sheets["設定"]).slice(1).map((r) => [r[0], r[1]]));
const nextNo = Number(set["次の番号"]) || 1;
const nextBc = Number(set["次のバーコード"]) || 1;
const main = set["在庫の正"] === "画面" ? "画面" : "エムネット";
sql.push(`UPDATE settings SET value = ${q(String(nextNo))} WHERE key = 'next_no';`);
sql.push(`UPDATE settings SET value = ${q(String(nextBc))} WHERE key = 'next_barcode';`);
sql.push(`UPDATE settings SET value = ${q(main)} WHERE key = 'stock_main';`);
sql.push(`UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver';`);
fs.writeFileSync(out, sql.join("\n") + "\n", "utf8");
console.log("書いた：", out);
console.log("件数：", JSON.stringify(counts));
console.log("設定：", JSON.stringify({ next_no: nextNo, next_barcode: nextBc, stock_main: main }));
