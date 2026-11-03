import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 出荷の記録（新しい順・取り消したものも出す）。?limit=件数（最大1000） */
export async function GET(req: Request) {
  await getCurrentUser();
  const limit = Math.min(1000, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100));
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT s.id, s.item_id, s.process_id, s.ship_date, s.qty, s.dest, s.contact, s.packages, s.carrier, s.slip_no, s.time_spec, s.note,
              s.from_stock, s.recorded_at, s.worker, s.canceled_at, s.canceled_by,
              COALESCE(c.mgmt_no, '') AS mgmt_no, COALESCE(i.drawing_no, '') AS drawing_no, COALESCE(i.name, '') AS name, (i.id IS NULL) AS gone
         FROM shipments s LEFT JOIN items i ON i.id = s.item_id LEFT JOIN cases c ON c.id = i.case_id
        ORDER BY s.ship_date DESC, s.recorded_at DESC LIMIT ?`
    )
    .bind(limit + 1)
    .all();
  return Response.json({ rows: results.slice(0, limit), more: results.length > limit });
}
