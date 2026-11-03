import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadStock, loadStockDetail, stockAct, StockError } from "@/lib/kotei/stock";

export const dynamic = "force-dynamic";

/** 在庫の一覧（全員見られる）。?dw=図面番号 でその図面番号の仕掛品の内訳と履歴 */
export async function GET(req: Request) {
  await getCurrentUser();
  const db = await getDb();
  const dw = new URL(req.url).searchParams.get("dw");
  return Response.json(dw ? await loadStockDetail(db, dw) : await loadStock(db));
}

/** 数を直す・どちらの数を正にするか（管理者だけ。在庫の数を勝手に変えられないように） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "在庫の数を直せるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : "");
  try {
    if (b.kind === "adjust") await stockAct(await getDb(), { kind: "adjust", dw: s(b.dw), n: s(b.n), reason: s(b.reason) }, user.email, user.name);
    else if (b.kind === "main") await stockAct(await getDb(), { kind: "main", main: s(b.main) }, user.email, user.name);
    else return Response.json({ error: "知らない操作です" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StockError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
