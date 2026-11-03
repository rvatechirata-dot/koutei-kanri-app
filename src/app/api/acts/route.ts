import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ActError, applyActs, type Act } from "@/lib/kotei/acts";
import { masterMap, normOne } from "@/lib/kotei/rules";

export const dynamic = "force-dynamic";

const OPS = new Set(["start", "done", "undoStart", "undoDone", "pMemo", "wStart", "wAdd", "wEnd", "wEdit", "wUndo"]);
const STR_KEYS = ["pid", "wid", "qty", "ng", "memo", "why", "mc", "s", "e"] as const;
const SHIP_KEYS = ["ship_date", "dest", "contact", "packages", "carrier", "slip_no", "time_spec", "note", "from_stock"] as const;

/** 送られてきた操作を、決まった項目だけの形にする（知らない項目は捨てる） */
function cleanActs(v: unknown): Act[] | null {
  if (!Array.isArray(v)) return null;
  const out: Act[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.op !== "string" || !OPS.has(o.op)) return null;
    const a: Record<string, unknown> = { op: o.op };
    for (const k of STR_KEYS) if (o[k] !== undefined) a[k] = String(o[k]).slice(0, 2000);
    if (typeof o.base === "string") a.base = o.base.slice(0, 4000);
    else if (o.base && typeof o.base === "object") {
      const b = o.base as Record<string, unknown>;
      a.base = { s: String(b.s ?? ""), e: String(b.e ?? "") };
    }
    if (o.ship && typeof o.ship === "object") {
      const sh = o.ship as Record<string, unknown>;
      a.ship = Object.fromEntries(SHIP_KEYS.filter((k) => sh[k] !== undefined).map((k) => [k, String(sh[k]).slice(0, 500)]));
    }
    out.push(a as unknown as Act);
  }
  return out;
}

/**
 * 工程の開始・完了・取り消し・コメント・作業（2段目）。Access を通れた社員は全員押せる。
 * 作業者＝ログインした人の全社マスタの名前（名寄せで基本の一覧の書き方にそろえる）。
 * 共有メールなどで名前が決まらないときだけ、画面で選んだ名前（基本の一覧の作業者にある名前に限る）。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = (await req.json()) as { acts?: unknown; worker?: unknown; opId?: unknown };
  const acts = cleanActs(body.acts);
  const opId = typeof body.opId === "string" && /^[0-9a-z]{6,40}$/.test(body.opId) ? body.opId : "";
  if (!acts || !opId) return Response.json({ error: "送られてきた中身が読めませんでした。画面を開き直してください。" }, { status: 400 });
  const db = await getDb();
  const { results: masters } = await db.prepare("SELECT kind, name, aliases FROM masters WHERE unused = ''").all<{ kind: string; name: string; aliases: string }>();
  const map = masterMap(masters);
  let worker: string;
  if (user.named) worker = normOne(map, "作業者", user.name);
  else {
    worker = typeof body.worker === "string" ? body.worker.trim().slice(0, 40) : "";
    // 基本の一覧に作業者があれば、その中の名前に限る。まだ無いときは（試作と同じく）入れた名前のまま
    const list = masters.filter((m) => m.kind === "作業者").map((m) => m.name);
    if (!worker || (list.length > 0 && !list.includes(worker)))
      return Response.json({ error: "作業者を選んでください（共有のメールでログインしているため、名前が決まりません）。", needWorker: true }, { status: 400 });
  }
  try {
    const res = await applyActs(db, { acts, worker, account: user.email, opId, admin: isAdmin(user) });
    return Response.json(res);
  } catch (e) {
    if (e instanceof ActError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
