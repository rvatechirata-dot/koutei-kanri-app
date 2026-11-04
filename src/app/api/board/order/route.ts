import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { nowJst } from "@/lib/kotei/time";

export const dynamic = "force-dynamic";

/**
 * ボードの1つのレーンの中の並び（加工順）を保存する。{ lane: 工程名, pids: [左から順の工程ID] }。管理者だけ。
 * SBC加工予定ボードの「レーン内の並び替え」と同じ考え方（左から順に加工する）。並べた順に 1,2,3… を入れる。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "加工順を並べ替えられるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as { lane?: unknown; pids?: unknown };
  const pids = Array.isArray(b.pids) ? b.pids.filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
  if (!pids.length) return Response.json({ error: "並べる工程がありません" }, { status: 400 });
  const lane = typeof b.lane === "string" ? b.lane.slice(0, 100) : "";
  const db = await getDb();
  const now = nowJst();
  const J = JSON.stringify(pids);
  await db.batch([
    db
      .prepare("UPDATE processes SET lane_order = (SELECT CAST(key AS REAL) + 1 FROM json_each(?1) WHERE value = processes.id) WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(J),
    db
      .prepare("INSERT INTO action_log (at, recorded_at, account, worker, action, op_id, detail) VALUES (?, ?, ?, ?, '加工順の並べ替え', ?, ?)")
      .bind(now, now, user.email, user.name, "o" + Date.now().toString(36), `${lane}（${pids.length}件）`),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"),
  ]);
  return Response.json({ ok: true });
}
