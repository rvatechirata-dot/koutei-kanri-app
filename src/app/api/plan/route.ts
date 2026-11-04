import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { applyPlan, PlanError, type PlanChange } from "@/lib/kotei/plan";

export const dynamic = "force-dynamic";

/** 休日の一覧（ガントで灰色にする・稼働日でずらすのに使う。全員見られる） */
export async function GET() {
  await getCurrentUser();
  const { results } = await (await getDb()).prepare("SELECT date, memo FROM holidays ORDER BY date").all<{ date: string; memo: string }>();
  return Response.json(results);
}

/** 予定（開始予定・納期）を変える。{ changes: [{ pid, s, e, base: { s, e } }] }。管理者だけ */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "予定を変えられるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as { changes?: unknown };
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 20) : "");
  const changes: PlanChange[] = (Array.isArray(b.changes) ? b.changes.slice(0, 500) : []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const base = (o.base ?? {}) as Record<string, unknown>;
    return { pid: s(o.pid), s: s(o.s), e: s(o.e), base: { s: s(base.s), e: s(base.e) } };
  });
  if (!changes.length) return Response.json({ error: "変える予定がありません" }, { status: 400 });
  try {
    return Response.json({ changed: await applyPlan(await getDb(), changes, user.email, user.name) });
  } catch (e) {
    if (e instanceof PlanError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
