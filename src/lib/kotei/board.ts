/**
 * 工程一覧に出すデータを読む（サーバー側）。
 * 1品目＝1行。品目ごとに、案件の項目と、工程を順番どおりに全部つける。絞り込み・並べ替えは画面でする（試作と同じ）。
 * 単価・顧客の担当者・納品情報は工程一覧では使わないので送らない（見せる必要の無いものは出さない）。
 */
import { sortProcs } from "./rules";
import { workMark } from "./acts";

type Db = D1Database;

export interface BoardProc {
  id: string;
  seq: string;
  in_out: string;
  name: string;
  assignee: string;
  machine: string;
  plan_start: string;
  due: string;
  started_at: string;
  done_at: string;
  done_qty: string;
  started_by: string;
  done_by: string;
  defect_qty: string;
  defect_reason: string;
  comment: string;
  note: string;
  /** いま作業中の人（取り消していない・終わっていない作業） */
  working: string[];
  /** 取り消していない作業（古い順） */
  works: BoardWork[];
  /** この工程で記録した出荷の数の合計（取り消したものは除く） */
  shipped: number;
  /** この工程で記録した出荷（取り消したものは除く・古い順） */
  ships: { id: string; ship_date: string; qty: string; carrier: string; slip_no: string; from_stock: string }[];
}

export interface BoardWork {
  id: string;
  worker: string;
  account: string;
  started_at: string;
  ended_at: string;
  good_qty: string;
  defect_qty: string;
  comment: string;
  machine: string;
  defect_reason: string;
  source_key: string;
  /** 作業を直すときに「画面が見ていた行」を伝える印 */
  mark: string;
}

export interface BoardItem {
  id: string;
  barcode: string;
  kubun: string;
  drawing_no: string;
  name: string;
  qty: string;
  final_due: string;
  hidden: string;
  knowhow: string;
  note: string;
  source: string;
  case_id: string;
  mgmt_no: string;
  customer: string;
  customer_po: string;
  sales_rep: string;
  order_date: string;
  case_hidden: string;
  procs: BoardProc[];
}

export interface Board {
  ver: string;
  /** 基本の一覧（使わないものを除く）。作業者・機械・不良の理由の候補 */
  lists: { workers: string[]; machines: string[]; reasons: string[] };
  lastImport: { at: string; file: string } | null;
  items: BoardItem[];
}

export async function loadBoard(db: Db): Promise<Board> {
  const [ver, items, procs, works, imp, mst, shp] = await db.batch([
    db.prepare("SELECT value FROM settings WHERE key = 'ver'"),
    db.prepare(
      `SELECT i.id, i.barcode, i.kubun, i.drawing_no, i.name, i.qty, i.final_due, i.hidden, i.knowhow, i.note, i.source, i.case_id,
              COALESCE(c.mgmt_no, '') AS mgmt_no, COALESCE(c.customer, '') AS customer, COALESCE(c.customer_po, '') AS customer_po,
              COALESCE(c.sales_rep, '') AS sales_rep, COALESCE(c.order_date, '') AS order_date, COALESCE(c.hidden, '') AS case_hidden
         FROM items i LEFT JOIN cases c ON c.id = i.case_id`
    ),
    db.prepare(
      `SELECT id, item_id, seq, in_out, name, assignee, machine, plan_start, due, started_at, done_at, done_qty,
              started_by, done_by, defect_qty, defect_reason, comment, note FROM processes`
    ),
    db.prepare(
      `SELECT id, process_id, worker, account, started_at, ended_at, good_qty, defect_qty, comment, machine, defect_reason, source_key, canceled_at
         FROM works WHERE canceled_at = '' ORDER BY started_at, id`
    ),
    db.prepare("SELECT at, file FROM import_history ORDER BY id DESC LIMIT 1"),
    db.prepare("SELECT kind, name FROM masters WHERE unused = '' ORDER BY CAST(sort_order AS REAL), name"),
    db.prepare("SELECT id, process_id, ship_date, qty, carrier, slip_no, from_stock FROM shipments WHERE canceled_at = '' ORDER BY ship_date, recorded_at"),
  ]);
  const shipped: Record<string, number> = {};
  const shipsBy: Record<string, BoardProc["ships"]> = {};
  (shp.results as unknown as (BoardProc["ships"][number] & { process_id: string })[]).forEach((r) => {
    const { process_id, ...rest } = r;
    shipped[process_id] = (shipped[process_id] || 0) + (Number(r.qty) || 0);
    (shipsBy[process_id] ||= []).push(rest);
  });
  const working: Record<string, string[]> = {};
  const worksBy: Record<string, BoardWork[]> = {};
  (works.results as unknown as (Omit<BoardWork, "mark"> & { process_id: string; canceled_at: string })[]).forEach((w) => {
    const { process_id, canceled_at, ...rest } = w;
    (worksBy[process_id] ||= []).push({ ...rest, mark: workMark({ ...rest, canceled_at }) });
    if (w.ended_at) return;
    const list = (working[process_id] ||= []);
    if (w.worker && !list.includes(w.worker)) list.push(w.worker);
  });
  const lists = { workers: [] as string[], machines: [] as string[], reasons: [] as string[] };
  (mst.results as { kind: string; name: string }[]).forEach((m) => {
    if (m.kind === "作業者") lists.workers.push(m.name);
    if (m.kind === "機械") lists.machines.push(m.name);
    if (m.kind === "不良の理由") lists.reasons.push(m.name);
  });
  // 基本の一覧に作業者がまだ無いときは、今あるデータに出てくる名前を候補にする（試作と同じ）
  if (!lists.workers.length) {
    const seen = new Set<string>();
    (works.results as { worker: string }[]).forEach((w) => w.worker && seen.add(w.worker));
    (procs.results as { started_by: string; done_by: string }[]).forEach((p) => {
      if (p.started_by) seen.add(p.started_by);
      if (p.done_by) seen.add(p.done_by);
    });
    lists.workers = [...seen].sort((a, b) => a.localeCompare(b, "ja"));
  }
  const byItem: Record<string, BoardProc[]> = {};
  (procs.results as unknown as (BoardProc & { item_id: string })[]).forEach((p) => {
    const { item_id, ...rest } = p;
    (byItem[item_id] ||= []).push({ ...rest, working: working[p.id] ?? [], works: worksBy[p.id] ?? [], shipped: Math.round((shipped[p.id] ?? 0) * 1000) / 1000, ships: shipsBy[p.id] ?? [] });
  });
  const list = (items.results as unknown as Omit<BoardItem, "procs">[]).map((it) => ({ ...it, procs: sortProcs(byItem[it.id] ?? []) }));
  const last = (imp.results as { at: string; file: string }[])[0] ?? null;
  return { ver: (ver.results as { value: string }[])[0]?.value ?? "1", lists, lastImport: last, items: list };
}
