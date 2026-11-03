import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { previewImport } from "@/lib/kotei/importer";
import { checkRecs } from "@/lib/kotei/check";

export const dynamic = "force-dynamic";

/** CSVの行を今のデータと比べる（まだ保存しない）。取り込めるのは管理者だけ */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "CSVを取り込めるのは管理者だけです。" }, { status: 403 });
  const body = (await req.json()) as { recs?: unknown };
  const recs = checkRecs(body.recs);
  if (!recs) return Response.json({ error: "送られてきた中身が読めませんでした。CSVを選び直してください。" }, { status: 400 });
  return Response.json(await previewImport(await getDb(), recs));
}
