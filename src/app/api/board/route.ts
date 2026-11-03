import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadBoard } from "@/lib/kotei/board";

export const dynamic = "force-dynamic";

/**
 * 工程一覧のデータ（Access を通れた人は全員見られる）。me＝作業者の決め方を画面に伝える。
 * ?ver=番号 を付けると、更新番号が同じときは中身を返さず { same: true } だけ返す
 * （画面が1分ごとに確かめるため。毎回全部を読むと D1 の読み取りの枠を食う）。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const db = await getDb();
  const known = new URL(req.url).searchParams.get("ver");
  if (known) {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'ver'").first<{ value: string }>();
    if (row?.value === known) return Response.json({ same: true, ver: known });
  }
  const board = await loadBoard(db);
  return Response.json({ ...board, me: { name: user.name, named: user.named, admin: isAdmin(user) } });
}
