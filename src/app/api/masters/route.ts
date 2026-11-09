import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadMasters, MasterError, saveHolidays, saveMasters, type MasterPut } from "@/lib/kotei/masters";

export const dynamic = "force-dynamic";

const str = (v: unknown, n = 2000) => (typeof v === "string" ? v.slice(0, n) : "");

/** 基本の一覧・休日を読む（管理者だけ。名寄せは今あるデータをまとめて書き換えるため） */
export async function GET() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "基本の一覧を直せるのは管理者だけです。" }, { status: 403 });
  return Response.json(await loadMasters(await getDb()));
}

/** { kind: 'save', put, del, note }（足す・直す・名寄せ・外す）／{ kind: 'hol', put, del }（休日） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "基本の一覧を直せるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, 2000) : []);
  const db = await getDb();
  try {
    if (b.kind === "save") {
      const put: MasterPut[] = arr(b.put).map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const f = (o.f ?? {}) as Record<string, unknown>;
        return {
          id: str(o.id, 80),
          isNew: o.isNew === true,
          base: str(o.base),
          f: { kind: str(f.kind, 20), name: str(f.name, 200), aliases: str(f.aliases), sort_order: str(f.sort_order, 20), unused: str(f.unused, 1), memo: str(f.memo, 500) },
        };
      });
      const del = arr(b.del).map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { id: str(o.id, 80), base: str(o.base) };
      });
      return Response.json(await saveMasters(db, { put, del, note: str(b.note, 200) }, user.email, user.name));
    }
    if (b.kind === "hol") {
      const put = arr(b.put).map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { date: str(o.date, 10), memo: str(o.memo, 100) };
      });
      await saveHolidays(db, { put, del: arr(b.del).map((x) => str(x, 10)), note: str(b.note, 200) }, user.email, user.name);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "知らない操作です" }, { status: 400 });
  } catch (e) {
    if (e instanceof MasterError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
