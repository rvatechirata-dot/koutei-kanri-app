import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { commitImport, ImportConflict, type Choices } from "@/lib/kotei/importer";
import { checkRecs } from "@/lib/kotei/check";

export const dynamic = "force-dynamic";

const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 比べた結果を確かめたあとで取り込む。間にデータが変わっていたら 409（比べ直してもらう） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "CSVを取り込めるのは管理者だけです。" }, { status: 403 });
  const body = (await req.json()) as { recs?: unknown; ver?: unknown; file?: unknown; choices?: Record<string, unknown> };
  const recs = checkRecs(body.recs);
  if (!recs || typeof body.ver !== "string") return Response.json({ error: "送られてきた中身が読めませんでした。CSVを選び直してください。" }, { status: 400 });
  const c = body.choices ?? {};
  const choices: Choices = { skipAdd: strList(c.skipAdd), skipChg: strList(c.skipChg), takeOld: strList(c.takeOld), gone: strList(c.gone) };
  const opId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    const res = await commitImport(await getDb(), {
      recs, ver: body.ver, choices, file: String(body.file ?? "").slice(0, 200), email: user.email, opId,
    });
    return Response.json(res);
  } catch (e) {
    if (e instanceof ImportConflict) return Response.json({ error: e.message, conflict: true }, { status: 409 });
    throw e;
  }
}
