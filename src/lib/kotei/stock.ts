/**
 * 在庫（3段目・サーバー側）。図面番号ごとの製品の数・仕掛品・出荷待ちと、数を直す・どちらを正にするか。
 * 数え方は川﨑課長の試作（index.html の buildStock・applyStock）と同じ：
 *   - 製品の数は「在庫の動き」を足して出す。帳簿は2つ＝エムネット（作業ログCSVの完品在庫数の写し）／画面（この画面の計算）
 *   - 仕掛品＝出荷の工程がまだの品目で、最後に終わった工程が「製品になる工程（出荷の1つ手前）」より前のもの。数＝その工程の完成数量か品目の数量
 *   - 出荷待ち＝出荷の工程がまだの品目の「数量 − 出荷した数」（まだ始まっていない品目も入る）
 *   - 物が動かない工程（材料発注など）と、区分「在庫管理」の品目は数えない
 */
import { sortProcs, stockRole, STOCK_CAT } from "./rules";
import { nowJst } from "./time";

type Db = D1Database;
const round = (n: number) => Math.round(n * 1000) / 1000;

export interface StockRow {
  dw: string;
  name: string;
  mnet: number; // エムネットの写し
  scr: number; // この画面の計算
  nM: number; // エムネットの帳簿の行の数（0なら「―」）
  nS: number;
  wip: Record<string, number>; // 「工程名 まで」→ 数
  wipN: number;
  wait: number; // 出荷待ち
}

export interface StockData {
  main: "エムネット" | "画面";
  rows: StockRow[];
}

interface ItemLite {
  id: string;
  kubun: string;
  drawing_no: string;
  name: string;
  qty: string;
  final_due: string;
  mgmt_no: string;
}
interface ProcLite {
  id: string;
  item_id: string;
  seq: string;
  name: string;
  done_at: string;
  done_qty: string;
}

async function loadBase(db: Db) {
  const [it, pr, sh, mv, st] = await db.batch([
    db.prepare(
      "SELECT i.id, i.kubun, i.drawing_no, i.name, i.qty, i.final_due, COALESCE(c.mgmt_no, '') AS mgmt_no FROM items i LEFT JOIN cases c ON c.id = i.case_id"
    ),
    db.prepare("SELECT id, item_id, seq, name, done_at, done_qty FROM processes"),
    db.prepare("SELECT item_id, SUM(CAST(qty AS REAL)) AS n FROM shipments WHERE canceled_at = '' GROUP BY item_id"),
    db.prepare("SELECT drawing_no, book, SUM(CAST(qty AS REAL)) AS n, COUNT(*) AS c FROM stock_moves GROUP BY drawing_no, book"),
    db.prepare("SELECT value FROM settings WHERE key = 'stock_main'"),
  ]);
  const procBy: Record<string, ProcLite[]> = {};
  (pr.results as unknown as ProcLite[]).forEach((p) => (procBy[p.item_id] ||= []).push(p));
  const shipped: Record<string, number> = {};
  (sh.results as { item_id: string; n: number }[]).forEach((r) => (shipped[r.item_id] = Number(r.n) || 0));
  return {
    items: it.results as unknown as ItemLite[],
    procBy,
    shipped,
    moves: mv.results as { drawing_no: string; book: string; n: number; c: number }[],
    main: ((st.results as { value: string }[])[0]?.value === "画面" ? "画面" : "エムネット") as StockData["main"],
  };
}

interface Built {
  rows: Record<string, StockRow & { wipItems: { item: ItemLite; stage: string; n: number }[] }>;
  main: StockData["main"];
}

async function build(db: Db): Promise<Built> {
  const b = await loadBase(db);
  const stk: Built["rows"] = {};
  const sk = (dw: string) => (stk[dw] ||= { dw, name: "", mnet: 0, scr: 0, nM: 0, nS: 0, wip: {}, wipN: 0, wait: 0, wipItems: [] });
  b.moves.forEach((m) => {
    const x = sk(m.drawing_no);
    if (m.book === "エムネット") {
      x.mnet += Number(m.n) || 0;
      x.nM += m.c;
    } else {
      x.scr += Number(m.n) || 0;
      x.nS += m.c;
    }
  });
  b.items.forEach((it) => {
    const ps = sortProcs(b.procBy[it.id] ?? []);
    if (it.kubun === STOCK_CAT && it.drawing_no) {
      const x = sk(it.drawing_no);
      if (!x.name) x.name = it.name;
    }
    const role = stockRole(it.kubun, ps);
    if (!role) return;
    const x = sk(it.drawing_no);
    if (!x.name) x.name = it.name;
    const byId: Record<string, ProcLite> = {};
    ps.forEach((p) => (byId[p.id] = p));
    if (byId[role.ship]?.done_at) return;
    const q = role.q.map((id) => byId[id]);
    let last = -1;
    q.forEach((p, i) => {
      if (p.done_at) last = i;
    });
    if (last >= 0 && last < q.length - 2) {
      const n = Number(q[last].done_qty) || Number(it.qty) || 0;
      const k = q[last].name + " まで";
      x.wip[k] = (x.wip[k] || 0) + n;
      x.wipN += n;
      x.wipItems.push({ item: it, stage: q[last].name, n });
    }
    const rest = Math.max(0, (Number(it.qty) || 0) - (b.shipped[it.id] || 0));
    if (rest) x.wait += rest;
  });
  Object.values(stk).forEach((x) => {
    x.mnet = round(x.mnet);
    x.scr = round(x.scr);
    x.wipN = round(x.wipN);
    x.wait = round(x.wait);
  });
  return { rows: stk, main: b.main };
}

export async function loadStock(db: Db): Promise<StockData> {
  const s = await build(db);
  const rows = Object.values(s.rows)
    .filter((x) => x.dw)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ wipItems, ...r }) => r)
    .sort((a, c) => a.dw.localeCompare(c.dw, "ja", { numeric: true }));
  return { main: s.main, rows };
}

export interface StockDetail {
  dw: string;
  wipItems: { mgmt_no: string; stage: string; n: number; final_due: string }[];
  moves: { at: string; book: string; kind: string; qty: string; where: string; detail: string; worker: string }[];
}

/** 1つの図面番号の、仕掛品の内訳と、増えた・減ったの履歴（新しい300件） */
export async function loadStockDetail(db: Db, dw: string): Promise<StockDetail> {
  const s = await build(db);
  const x = s.rows[dw];
  const { results } = await db
    .prepare(
      `SELECT m.at, m.book, m.kind, m.qty, m.detail, m.worker, m.item_id, m.process_id,
              COALESCE(c.mgmt_no, '') AS mgmt_no, COALESCE(p.name, '') AS pname, (i.id IS NULL) AS gone
         FROM stock_moves m LEFT JOIN items i ON i.id = m.item_id LEFT JOIN cases c ON c.id = i.case_id LEFT JOIN processes p ON p.id = m.process_id
        WHERE m.drawing_no = ? ORDER BY m.at DESC, m.rowid DESC LIMIT 300`
    )
    .bind(dw)
    .all<{ at: string; book: string; kind: string; qty: string; detail: string; worker: string; item_id: string; mgmt_no: string; pname: string; gone: number }>();
  return {
    dw,
    wipItems: (x?.wipItems ?? []).map((w) => ({ mgmt_no: w.item.mgmt_no, stage: w.stage, n: w.n, final_due: w.item.final_due })),
    moves: results.map((m) => ({
      at: m.at,
      book: m.book,
      kind: m.kind,
      qty: m.qty,
      where: m.item_id ? (m.gone ? "（消えた品目）" : m.mgmt_no) + (m.pname ? " " + m.pname : "") : "",
      detail: m.detail,
      worker: m.worker,
    })),
  };
}

export class StockError extends Error {}

/** 数を直す（増やす数。減らすときは −。理由は必ず）／どちらの数を正にするか。管理者だけ（API で確かめる） */
export async function stockAct(
  db: Db,
  d: { kind: "adjust"; dw: string; n: string; reason: string } | { kind: "main"; main: string },
  who: string,
  worker: string
): Promise<void> {
  const now = nowJst();
  const op = "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const logSql = db.prepare(
    "INSERT INTO action_log (at, recorded_at, account, worker, action, qty, op_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const verSql = db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'");
  if (d.kind === "adjust") {
    const dw = d.dw.trim();
    const reason = d.reason.trim();
    if (!dw) throw new StockError("図面番号がありません");
    if (!/^-?\d+(\.\d+)?$/.test(d.n) || !Number(d.n)) throw new StockError("直す数（増やす・減らす数）を入れてください");
    if (!reason) throw new StockError("数を直す理由を書いてください（棚卸しの差・数え間違い など）");
    await db.batch([
      db
        .prepare(
          "INSERT INTO stock_moves (id, at, recorded_at, account, worker, drawing_no, qty, kind, book, detail, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, '数を直す', '画面', ?, ?)"
        )
        .bind(`M${op}-1`, now, now, who, worker, dw, String(round(Number(d.n))), reason, op),
      logSql.bind(now, now, who, worker, "在庫の数を直す", d.n, op, `${dw}：${reason}`),
      verSql,
    ]);
  } else {
    if (d.main !== "エムネット" && d.main !== "画面") throw new StockError(`知らない選び方です（${d.main}）`);
    await db.batch([
      db.prepare("UPDATE settings SET value = ? WHERE key = 'stock_main'").bind(d.main),
      logSql.bind(now, now, who, worker, "在庫の正を変える", "", op, d.main === "画面" ? "この画面の数を正にした" : "エムネットの写しを正にした"),
      verSql,
    ]);
  }
}
