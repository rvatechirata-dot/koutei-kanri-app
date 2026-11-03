/**
 * 工程一覧に出すデータを読む（サーバー側）。
 * 1品目＝1行。品目ごとに、案件の項目と、工程を順番どおりに全部つける。絞り込み・並べ替えは画面でする（試作と同じ）。
 * 単価・顧客の担当者・納品情報は工程一覧では使わないので送らない（見せる必要の無いものは出さない）。
 */
import { sortProcs } from "./rules";

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
  comment: string;
  note: string;
  /** いま作業中の人（取り消していない・終わっていない作業） */
  working: string[];
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
  lastImport: { at: string; file: string } | null;
  items: BoardItem[];
}

export async function loadBoard(db: Db): Promise<Board> {
  const [ver, items, procs, works, imp] = await db.batch([
    db.prepare("SELECT value FROM settings WHERE key = 'ver'"),
    db.prepare(
      `SELECT i.id, i.barcode, i.kubun, i.drawing_no, i.name, i.qty, i.final_due, i.hidden, i.knowhow, i.note, i.source, i.case_id,
              COALESCE(c.mgmt_no, '') AS mgmt_no, COALESCE(c.customer, '') AS customer, COALESCE(c.customer_po, '') AS customer_po,
              COALESCE(c.sales_rep, '') AS sales_rep, COALESCE(c.order_date, '') AS order_date, COALESCE(c.hidden, '') AS case_hidden
         FROM items i LEFT JOIN cases c ON c.id = i.case_id`
    ),
    db.prepare(
      `SELECT id, item_id, seq, in_out, name, assignee, machine, plan_start, due, started_at, done_at, done_qty,
              started_by, done_by, defect_qty, comment, note FROM processes`
    ),
    db.prepare("SELECT process_id, worker FROM works WHERE ended_at = '' AND canceled_at = ''"),
    db.prepare("SELECT at, file FROM import_history ORDER BY id DESC LIMIT 1"),
  ]);
  const working: Record<string, string[]> = {};
  (works.results as { process_id: string; worker: string }[]).forEach((w) => {
    const list = (working[w.process_id] ||= []);
    if (w.worker && !list.includes(w.worker)) list.push(w.worker);
  });
  const byItem: Record<string, BoardProc[]> = {};
  (procs.results as unknown as (BoardProc & { item_id: string })[]).forEach((p) => {
    const { item_id, ...rest } = p;
    (byItem[item_id] ||= []).push({ ...rest, working: working[p.id] ?? [] });
  });
  const list = (items.results as unknown as Omit<BoardItem, "procs">[]).map((it) => ({ ...it, procs: sortProcs(byItem[it.id] ?? []) }));
  const last = (imp.results as { at: string; file: string }[])[0] ?? null;
  return { ver: (ver.results as { value: string }[])[0]?.value ?? "1", lastImport: last, items: list };
}
