import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { commitWorklog } from "@/lib/kotei/worklog";
import { checkLines } from "../check";

export const dynamic = "force-dynamic";

/** エムネットの作業ログCSVから、作業と完品在庫数を写す。同じ行は二重に入らない。管理者だけ */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "作業ログを取り込めるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as Record<string, unknown>;
  const lines = checkLines(b.lines);
  if (!lines) return Response.json({ error: "送られてきた中身が読めませんでした。CSVを選び直してください。" }, { status: 400 });
  const res = await commitWorklog(await getDb(), {
    lines,
    hasWork: b.hasWork === true,
    hasStock: b.hasStock === true,
    doWork: b.doWork === true,
    doStock: b.doStock === true,
    init: b.init === true,
    file: String(b.file ?? "").slice(0, 200),
    email: user.email,
    worker: user.name,
  });
  return Response.json(res);
}
