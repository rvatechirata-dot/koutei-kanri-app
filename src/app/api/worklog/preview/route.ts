import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { previewWorklog } from "@/lib/kotei/worklog";
import { checkLines } from "../check";

export const dynamic = "force-dynamic";

/** エムネットの作業ログCSVの行を、今のデータと比べる（まだ保存しない）。管理者だけ */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "作業ログを取り込めるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as { lines?: unknown; hasWork?: unknown; hasStock?: unknown };
  const lines = checkLines(b.lines);
  if (!lines) return Response.json({ error: "送られてきた中身が読めませんでした。CSVを選び直してください。" }, { status: 400 });
  return Response.json(await previewWorklog(await getDb(), lines, b.hasWork === true, b.hasStock === true));
}
