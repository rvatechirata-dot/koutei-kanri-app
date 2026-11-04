import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadSummary } from "@/lib/kotei/summary";

export const dynamic = "force-dynamic";

/** 集計の材料（全員見られる）。?from=YYYY/MM/DD&to=YYYY/MM/DD&noW=1（作業を分けずに完了した工程も入れる） */
export async function GET(req: Request) {
  await getCurrentUser();
  const u = new URL(req.url).searchParams;
  const ok = (s: string | null) => (s && /^\d{4}\/\d{2}\/\d{2}$/.test(s) ? s : null);
  const from = ok(u.get("from"));
  const to = ok(u.get("to"));
  if (!from || !to) return Response.json({ error: "期間の形がおかしいです" }, { status: 400 });
  return Response.json(await loadSummary(await getDb(), from, to, u.get("noW") === "1"));
}
