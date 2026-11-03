/**
 * エムネットの「作業ログの書き出し」CSVの取り込み（3段目・サーバー側）。1回読み込むと2つに使う：
 *   ① 作業を写す：工程の中の作業（作業者・開始・終了・完成数）。品目はバーコード、工程は名寄せした工程名で探す（同じ名前が2つ以上なら先の方）
 *   ② 完品在庫数を写す：工程名が「完品在庫数」の行を、在庫の動き（帳簿＝エムネット）に足す
 * 同じ行は二重に入れない（「もと」に行の印を入れる）。印の作り方は試作（index.html の parseWorkLog・parseMnetLog）と同じなので、
 * 試作で写した行（移したデータ）とも突き合わさる。
 * 画面は CSV を読んで、見出しの名前で欄を拾った「生の文字」を送ってくる（文字コードの判定は画面＝ブラウザでする）。
 */
import { han } from "./csv";
import { masterMap, normOne, type MasterMap } from "./rules";
import { nowJst } from "./time";

type Db = D1Database;

/** CSVの1行（見出しの名前で拾った生の文字。無い欄は空） */
export interface LogLine {
  line: number;
  bc: string; // バーコード
  proc: string; // 工程名
  st: string; // 開始時刻
  en: string; // 終了時刻
  worker: string; // 作業者
  qty: string; // 完成数量
  mc: string; // 機械名
  dw: string; // 図面番号
  name: string; // 品名
  mgmt: string; // 社内管理番号
  note: string; // 備考
}

/** 作業を写すのに要る見出しと、完品在庫数を写すのに要る見出し */
export const NEED_WORK = ["バーコード", "工程名", "開始時刻", "終了時刻", "作業者", "完成数量"];
export const NEED_STOCK = ["社内管理番号", "バーコード", "図面番号", "品名", "工程名", "開始時刻", "終了時刻", "作業者", "完成数量"];

const okAt = (v: string) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(v);
const fmtN = (n: unknown) => String(Math.round((Number(n) || 0) * 1000) / 1000);

interface WorkPut {
  key: string;
  item_id: string;
  process_id: string;
  worker: string;
  s: string;
  e: string;
  qty: string;
  mc: string;
}
interface StockPut {
  key: string;
  at: string;
  dw: string;
  n: string;
  what: string;
}

interface Plan {
  works: WorkPut[];
  workSame: number;
  workStockRows: number; // 完品在庫数・材料在庫数の行（作業には写さない）
  workBlank: number; // 日時が読めない
  workAmb: number; // 同じ名前の工程が2つ以上
  noItem: Record<string, number>;
  noProc: Record<string, number>;
  stock: StockPut[]; // 新しく写す完品在庫数の行
  stockAll: number;
  stockErrs: string[];
  dws: { dw: string; name: string; sum: number; n: number; fresh: number; init: boolean; after: number }[];
  missing: number; // 前に写した行のうち、このCSVの同じ期間に無いもの
  from: string;
  to: string;
}

async function plan(db: Db, lines: LogLine[], hasWork: boolean, hasStock: boolean): Promise<Plan> {
  const [it, pr, wk, mv, ms] = await db.batch([
    db.prepare("SELECT i.id, i.barcode, COALESCE(c.mgmt_no, '') AS mgmt_no FROM items i LEFT JOIN cases c ON c.id = i.case_id"),
    db.prepare("SELECT id, item_id, seq, name FROM processes ORDER BY item_id, CAST(seq AS REAL)"),
    db.prepare("SELECT source_key FROM works WHERE source_key <> ''"),
    db.prepare("SELECT drawing_no, book, kind, qty, at, source_key FROM stock_moves"),
    db.prepare("SELECT kind, name, aliases FROM masters"),
  ]);
  const map: MasterMap = masterMap(ms.results as { kind: string; name: string; aliases: string }[]);
  const byBc: Record<string, { id: string; mgmt_no: string }> = {};
  (it.results as { id: string; barcode: string; mgmt_no: string }[]).forEach((r) => (byBc[r.barcode] = r));
  const procBy: Record<string, { id: string; name: string }[]> = {};
  (pr.results as { id: string; item_id: string; name: string }[]).forEach((p) => (procBy[p.item_id] ||= []).push(p));
  const haveW = new Set((wk.results as { source_key: string }[]).map((r) => r.source_key));
  const moves = mv.results as { drawing_no: string; book: string; kind: string; qty: string; at: string; source_key: string }[];

  const out: Plan = {
    works: [], workSame: 0, workStockRows: 0, workBlank: 0, workAmb: 0, noItem: {}, noProc: {},
    stock: [], stockAll: 0, stockErrs: [], dws: [], missing: 0, from: "", to: "",
  };

  if (hasWork) {
    const seen: Record<string, number> = {};
    lines.forEach((r) => {
      const raw = r.proc.trim();
      if (raw === "完品在庫数" || raw === "材料在庫数") {
        out.workStockRows++;
        return;
      }
      const bc = han(r.bc);
      const st = r.st.trim();
      const en = r.en.trim();
      let s = st.slice(0, 16);
      const e = en.slice(0, 16);
      if (!s) s = e;
      if (!okAt(s) || (e && !okAt(e))) {
        out.workBlank++;
        return;
      }
      const base = [bc, raw, st, en, r.worker, r.qty].join("|");
      seen[base] = (seen[base] || 0) + 1;
      const key = base + "#" + seen[base];
      if (haveW.has(key)) {
        out.workSame++;
        return;
      }
      const item = byBc[bc];
      if (!item) {
        out.noItem[bc] = (out.noItem[bc] || 0) + 1;
        return;
      }
      const name = normOne(map, "工程名", raw);
      const ps = (procBy[item.id] ?? []).filter((p) => p.name === name);
      if (!ps.length) {
        const k = `${item.mgmt_no} ${raw}`;
        out.noProc[k] = (out.noProc[k] || 0) + 1;
        return;
      }
      if (ps.length > 1) out.workAmb++;
      const q = han(r.qty);
      out.works.push({
        key, item_id: item.id, process_id: ps[0].id, worker: normOne(map, "作業者", r.worker.trim()), s, e,
        qty: /^\d+(\.\d+)?$/.test(q) ? fmtN(q) : "", mc: normOne(map, "機械", r.mc.trim()),
      });
    });
  }

  if (hasStock) {
    const seen: Record<string, number> = {};
    const all: StockPut[] = [];
    lines.forEach((r) => {
      const end = r.en.trim();
      const at = end.slice(0, 16);
      if (at) {
        if (!out.from || at < out.from) out.from = at;
        if (!out.to || at > out.to) out.to = at;
      }
      if (r.proc.trim() !== "完品在庫数") return;
      const n = han(r.qty);
      const dw = r.dw.trim();
      if (!/^-?\d+(\.\d+)?$/.test(n) || !dw || !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(at)) {
        out.stockErrs.push(`${r.line}行目：読めないので飛ばします（${dw} ${end} ${n}）`);
        return;
      }
      const base = [r.bc, r.st, end, r.worker, n].join("|");
      seen[base] = (seen[base] || 0) + 1;
      all.push({ key: base + "#" + seen[base], at, dw, n: fmtN(n), what: [r.worker, r.note].filter(Boolean).join(" ") });
      // 品名は図面番号ごとの見出しに使う
      (all[all.length - 1] as StockPut & { name?: string }).name = r.name;
    });
    out.stockAll = all.length;
    const have = new Set(moves.filter((m) => m.book === "エムネット" && m.source_key).map((m) => m.source_key));
    out.stock = all.filter((x) => !have.has(x.key));
    const inLog = new Set(all.map((x) => x.key));
    out.missing = moves.filter((m) => m.book === "エムネット" && m.at >= out.from && m.at <= out.to && !inLog.has(m.source_key)).length;
    const mnetSum: Record<string, number> = {};
    const inited = new Set<string>();
    moves.forEach((m) => {
      if (m.book === "エムネット") mnetSum[m.drawing_no] = (mnetSum[m.drawing_no] || 0) + (Number(m.qty) || 0);
      if (m.book === "画面" && m.kind === "最初の数") inited.add(m.drawing_no);
    });
    const by: Record<string, Plan["dws"][number]> = {};
    all.forEach((x) => {
      const b = (by[x.dw] ||= { dw: x.dw, name: (x as StockPut & { name?: string }).name || "", sum: 0, n: 0, fresh: 0, init: !inited.has(x.dw), after: mnetSum[x.dw] || 0 });
      b.sum += Number(x.n);
      b.n++;
      if (!have.has(x.key)) {
        b.fresh++;
        b.after += Number(x.n);
      }
    });
    out.dws = Object.values(by)
      .map((b) => ({ ...b, sum: Math.round(b.sum * 1000) / 1000, after: Math.round(b.after * 1000) / 1000 }))
      .sort((a, c) => a.dw.localeCompare(c.dw, "ja", { numeric: true }));
  }
  return out;
}

export interface WorklogPreview {
  hasWork: boolean;
  hasStock: boolean;
  total: number;
  work: { fresh: number; same: number; stockRows: number; blank: number; amb: number; noItem: number; noProc: [string, number][] };
  stock: { all: number; fresh: number; errs: string[]; dws: Plan["dws"]; missing: number; from: string; to: string };
}

export async function previewWorklog(db: Db, lines: LogLine[], hasWork: boolean, hasStock: boolean): Promise<WorklogPreview> {
  const p = await plan(db, lines, hasWork, hasStock);
  return {
    hasWork,
    hasStock,
    total: lines.length,
    work: {
      fresh: p.works.length, same: p.workSame, stockRows: p.workStockRows, blank: p.workBlank, amb: p.workAmb,
      noItem: Object.values(p.noItem).reduce((s, n) => s + n, 0),
      noProc: Object.entries(p.noProc).sort((a, b) => b[1] - a[1]).slice(0, 50),
    },
    stock: { all: p.stockAll, fresh: p.stock.length, errs: p.stockErrs.slice(0, 50), dws: p.dws, missing: p.missing, from: p.from, to: p.to },
  };
}

/**
 * 写す。doWork＝作業を写す、doStock＝完品在庫数を写す、init＝「この画面の計算」に最初の数がまだ無い図面番号には、エムネットの合計を最初の数として入れる
 * 作業は工程の開始・完了も数も変えない（試作と同じ。エムネットから写した作業は見比べる用）。
 */
export async function commitWorklog(
  db: Db,
  p: { lines: LogLine[]; hasWork: boolean; hasStock: boolean; doWork: boolean; doStock: boolean; init: boolean; file: string; email: string; worker: string }
): Promise<{ works: number; stock: number; init: number }> {
  const pl = await plan(db, p.lines, p.hasWork && p.doWork, p.hasStock && p.doStock);
  const now = nowJst();
  const op = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const works = p.doWork ? pl.works : [];
  const stock = p.doStock ? pl.stock : [];
  const inits = p.doStock && p.init ? pl.dws.filter((b) => b.init) : [];
  const stmts: D1PreparedStatement[] = [];
  const each = (table: string, cols: string[], rows: Record<string, string>[]) => {
    if (!rows.length) return;
    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`)
        .bind(JSON.stringify(rows))
    );
  };
  each(
    "works",
    ["id", "item_id", "process_id", "worker", "started_at", "ended_at", "good_qty", "machine", "source_key", "recorded_at", "account", "op_id"],
    works.map((w, k) => ({
      id: `W${op}-${k + 1}`, item_id: w.item_id, process_id: w.process_id, worker: w.worker, started_at: w.s, ended_at: w.e,
      good_qty: w.qty, machine: w.mc, source_key: w.key, recorded_at: now, account: p.email, op_id: op,
    }))
  );
  const MV = ["id", "at", "recorded_at", "account", "worker", "drawing_no", "qty", "kind", "book", "detail", "op_id", "source_key"];
  each(
    "stock_moves",
    MV,
    [
      ...stock.map((x, k) => ({
        id: `M${op}-${k + 1}`, at: x.at, recorded_at: now, account: p.email, worker: p.worker, drawing_no: x.dw, qty: x.n,
        kind: "エムネットの写し", book: "エムネット", detail: x.what, op_id: op, source_key: x.key,
      })),
      ...inits.map((b, k) => ({
        id: `M${op}-i${k + 1}`, at: now, recorded_at: now, account: p.email, worker: p.worker, drawing_no: b.dw, qty: fmtN(b.after),
        kind: "最初の数", book: "画面", detail: "エムネットの完品在庫数の合計から", op_id: op, source_key: "",
      })),
    ]
  );
  const logs: Record<string, string>[] = [];
  if (works.length) logs.push({ action: "作業ログの取り込み", detail: `エムネットの作業 ${works.length}件（${p.file}）` });
  if (stock.length || inits.length) logs.push({ action: "エムネットの在庫を写す", detail: `新しい行 ${stock.length}・最初の数 ${inits.length}件（${p.file}）` });
  logs.forEach((l) =>
    stmts.push(
      db
        .prepare("INSERT INTO action_log (at, recorded_at, account, worker, action, op_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(now, now, p.email, p.worker, l.action, op, l.detail)
    )
  );
  if (stmts.length) {
    stmts.push(
      db
        .prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, 'import', 'csv', ?, ?)")
        .bind(now, p.email, op, `作業ログ ${p.file}：作業 ${works.length}・在庫の行 ${stock.length}・最初の数 ${inits.length}`)
    );
    stmts.push(db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"));
    await db.batch(stmts);
  }
  return { works: works.length, stock: stock.length, init: inits.length };
}
