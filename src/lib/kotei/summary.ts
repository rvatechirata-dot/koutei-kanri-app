/**
 * 集計の材料（4段目・サーバー側）。数え方は試作（index.html の sumFacts・sumStd）と同じ：
 *   - 期間に入る「取り消していない作業」1回ずつ（日付＝作業の終了日、作業中は開始日）。物が動かない工程（材料入荷など）の作業は数えない
 *   - 「作業を分けずに完了した工程も入れる」：作業が1つも無い完了済みの工程を、工程の完成数量・不良数で1件として入れる（時間は無し・日付＝完了日）
 *   - 作業時間＝終了−開始（休み時間も入る）。作業中・終了が開始より前のものは時間に入れない
 *   - 10時間の上限（エムネットから写した作業だけ）は画面で選べるように、ここでは「もと」があるかと分を渡す
 *   - 名前は基本の一覧の名寄せでそろえる（作業・出荷の行は書き換えていないため）
 * 1件ずつの「材料」をここで作り、まとめ方・並べ方・しぼり込みは画面でする。
 */
import { masterMap, normOne, NOQTY } from "./rules";

type Db = D1Database;

export interface Fact {
  w: boolean; // 作業（false＝作業を分けずに完了した工程）
  day: string;
  pid: string;
  proc: string; // 名寄せした工程名
  dw: string;
  item: string; // 品名
  mgmt: string;
  customer: string;
  who: string;
  mc: string;
  min: number | null; // 作業時間（分）。作業中などは null
  src: boolean; // エムネットから写した作業
  qty: number;
  ng: number;
  why: string; // 不良の理由（不良が無ければ空）
  open: boolean;
}

export interface StdRow {
  pid: string;
  mgmt: string;
  dw: string;
  proc: string;
  std: number;
  works: { min: number | null; src: boolean; open: boolean; qty: number }[];
}

export interface Summary {
  facts: Fact[];
  std: StdRow[];
  nStd: number; // 基準時間が入っている工程の数（全部）
}

const toMin = (s: string): number | null => {
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
};
/** 作業時間（分）。作業中・時刻が読めない・終了が開始より前は null */
export function workMin(s: string, e: string): number | null {
  if (!e) return null;
  const a = toMin(s);
  const b = toMin(e);
  return a === null || b === null || b < a ? null : b - a;
}
const han = (s: string) => String(s ?? "").replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export async function loadSummary(db: Db, from: string, to: string, noW: boolean): Promise<Summary> {
  const [wq, pq, mq, nq] = await db.batch([
    db.prepare(
      `SELECT w.process_id, w.worker, w.machine, w.started_at, w.ended_at, w.good_qty, w.defect_qty, w.defect_reason, w.source_key,
              p.name AS pname, p.machine AS pmachine, p.std_time, i.drawing_no, i.name AS iname, COALESCE(c.mgmt_no, '') AS mgmt, COALESCE(c.customer, '') AS customer
         FROM works w JOIN processes p ON p.id = w.process_id JOIN items i ON i.id = p.item_id LEFT JOIN cases c ON c.id = i.case_id
        WHERE w.canceled_at = ''`
    ),
    db.prepare(
      `SELECT p.id, p.name, p.in_out, p.machine, p.assignee, p.done_at, p.done_by, p.done_qty, p.defect_qty, p.defect_reason,
              i.drawing_no, i.name AS iname, COALESCE(c.mgmt_no, '') AS mgmt, COALESCE(c.customer, '') AS customer
         FROM processes p JOIN items i ON i.id = p.item_id LEFT JOIN cases c ON c.id = i.case_id
        WHERE p.done_at <> '' AND substr(p.done_at, 1, 10) BETWEEN ? AND ?
          AND NOT EXISTS (SELECT 1 FROM works w WHERE w.process_id = p.id AND w.canceled_at = '')`
    ).bind(from, to),
    db.prepare("SELECT kind, name, aliases FROM masters"),
    db.prepare("SELECT COUNT(*) AS n FROM processes WHERE CAST(std_time AS REAL) > 0"),
  ]);
  const map = masterMap(mq.results as { kind: string; name: string; aliases: string }[]);
  const why = (ng: number, v: string) => (ng > 0 ? normOne(map, "不良の理由", v) || "（理由なし）" : "");
  const facts: Fact[] = [];
  const works = wq.results as Record<string, string>[];
  const byProc: Record<string, Record<string, string>[]> = {};
  works.forEach((w) => (byProc[w.process_id] ||= []).push(w));
  const stdPids = new Set<string>();
  works.forEach((w) => {
    if (NOQTY.includes(w.pname)) return;
    const day = (w.ended_at || w.started_at || "").slice(0, 10);
    if (!day || day < from || day > to) return;
    const ng = Number(w.defect_qty) || 0;
    facts.push({
      w: true, day, pid: w.process_id, proc: normOne(map, "工程名", w.pname), dw: w.drawing_no, item: w.iname, mgmt: w.mgmt, customer: w.customer,
      who: normOne(map, "作業者", w.worker), mc: normOne(map, "機械", w.machine || w.pmachine), min: workMin(w.started_at, w.ended_at),
      src: !!w.source_key, qty: Number(w.good_qty) || 0, ng, why: why(ng, w.defect_reason), open: !w.ended_at,
    });
    if (Number(han(w.std_time)) > 0) stdPids.add(w.process_id);
  });
  if (noW)
    (pq.results as Record<string, string>[]).forEach((p) => {
      if ((p.done_qty === "" && p.defect_qty === "") || NOQTY.includes(p.name)) return;
      const ng = Number(p.defect_qty) || 0;
      facts.push({
        w: false, day: p.done_at.slice(0, 10), pid: p.id, proc: normOne(map, "工程名", p.name), dw: p.drawing_no, item: p.iname, mgmt: p.mgmt, customer: p.customer,
        who: normOne(map, p.in_out === "外注" ? "外注先" : "作業者", p.done_by || p.assignee), mc: p.machine, min: null, src: false,
        qty: Number(p.done_qty) || 0, ng, why: why(ng, p.defect_reason), open: false,
      });
    });
  // 基準時間との比べ：基準時間が入っている工程のうち、期間に作業がある工程。作業時間はその工程の作業の合計（期間の外も入れる）
  const std: StdRow[] = [...stdPids].map((pid) => {
    const l = byProc[pid];
    const w0 = l[0];
    return {
      pid, mgmt: w0.mgmt, dw: w0.drawing_no, proc: w0.pname, std: Number(han(w0.std_time)),
      works: l.map((w) => ({ min: workMin(w.started_at, w.ended_at), src: !!w.source_key, open: !w.ended_at, qty: Number(w.good_qty) || 0 })),
    };
  });
  return { facts, std, nStd: Number((nq.results as { n: number }[])[0]?.n) || 0 };
}
