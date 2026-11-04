import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { EDIT_A, EDIT_I, EDIT_P, EditError, getCase, lastProcsOf, listCases, listTrash, restoreTrash, saveCase, trashCase, type SaveInput } from "@/lib/kotei/edit";

export const dynamic = "force-dynamic";

const str = (v: unknown, n = 5000) => (typeof v === "string" ? v.slice(0, n) : "");
const fields = <K extends string>(o: unknown, keys: readonly K[]) => {
  const src = (o ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, str(src[k])])) as Record<K, string>;
};

/**
 * 案件（管理者だけ）。?id=案件ID でその案件の中身、?template=図面番号&except=品目ID で「前回の並び」、?trash=1 でごみ箱、なしで一覧。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "案件を直せるのは管理者だけです。" }, { status: 403 });
  const u = new URL(req.url).searchParams;
  const db = await getDb();
  if (u.get("id")) {
    const doc = await getCase(db, u.get("id")!);
    return doc ? Response.json(doc) : Response.json({ error: "この案件が見つかりません" }, { status: 404 });
  }
  if (u.get("template") !== null) return Response.json(await lastProcsOf(db, u.get("template") ?? "", u.get("except") ?? ""));
  if (u.get("trash")) return Response.json(await listTrash(db));
  return Response.json(await listCases(db));
}

/** { kind: 'save', aid, isNew, base, a, items } ／ { kind: 'trash', aid, base } ／ { kind: 'restore', bundle } */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return Response.json({ error: "案件を直せるのは管理者だけです。" }, { status: 403 });
  const b = (await req.json()) as Record<string, unknown>;
  const db = await getDb();
  try {
    if (b.kind === "save") {
      const items = (Array.isArray(b.items) ? b.items.slice(0, 200) : []).map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return {
          id: str(o.id, 80),
          isNew: o.isNew === true,
          f: fields(o.f, EDIT_I),
          procs: (Array.isArray(o.procs) ? o.procs.slice(0, 200) : []).map((y) => {
            const p = (y ?? {}) as Record<string, unknown>;
            return { id: str(p.id, 80), isNew: p.isNew === true, f: fields(p.f, EDIT_P) };
          }),
        };
      });
      const d: SaveInput = { aid: str(b.aid, 80), isNew: b.isNew === true, base: str(b.base, 2_000_000), a: fields(b.a, EDIT_A), items };
      return Response.json(await saveCase(db, d, user.email, user.name));
    }
    if (b.kind === "trash") {
      await trashCase(db, str(b.aid, 80), str(b.base, 2_000_000), user.email, user.name);
      return Response.json({ ok: true });
    }
    if (b.kind === "restore") {
      await restoreTrash(db, str(b.bundle, 80), user.email, user.name);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "知らない操作です" }, { status: 400 });
  } catch (e) {
    if (e instanceof EditError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
