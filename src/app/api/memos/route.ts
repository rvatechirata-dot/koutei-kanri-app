import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { nowJst } from "@/lib/kotei/time";

export const dynamic = "force-dynamic";

/**
 * 案件メモ欄（2026-11-24・川﨑部長の画面案 案3・migration 0003）。Access を通れた社員は全員書ける。
 *   この案件のメモ（item_memos）：書くたびに1行増える。消せるのは書いた本人と管理者（行は残す）。
 *   品番の注意（drawing_notes）：図面番号ごと。直すたびに1行増やし、いちばん新しい行が今の注意。
 * 書いた人＝ログインした人。共有メールのときは画面で選んだ作業者の名前を添える（メールは必ず残す）。
 *
 * GET ?drawing=図面番号 → その品番の注意の前の版（新しい順・50件）
 * POST { op: "add", item_id, kind, body, toDrawing?, opId, name? }
 *      { op: "cancel", id }
 *      { op: "drawing", drawing_no, body, base（見ていた版の行ID・無ければ ""）, opId, name? }
 */
const KINDS = ["必要事項", "注意", "現品票", "連絡"];
const MAX_MEMO = 2000;
const MAX_NOTE = 5000;
const newId = (h: string) => h + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const VER = "UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function GET(req: Request) {
  await getCurrentUser();
  const dwg = (new URL(req.url).searchParams.get("drawing") ?? "").trim();
  if (!dwg) return Response.json({ error: "図面番号がありません" }, { status: 400 });
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT id, body, saved_at, saved_name FROM drawing_notes WHERE drawing_no = ? ORDER BY rowid DESC LIMIT 50")
    .bind(dwg)
    .all();
  return Response.json({ history: results });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const b = (await req.json()) as Record<string, unknown>;
  const db = await getDb();
  const now = nowJst();
  // 共有メールのときだけ、画面で選んだ名前を使う（ログインした人の名前が決まっていればそちら）
  const name = user.named ? user.name : str(b.name, 50).trim() || user.email;
  const opId = str(b.opId, 40) || newId("m");
  const log = (action: string, detail: string) =>
    db.prepare("INSERT INTO action_log (at, recorded_at, account, worker, action, op_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(now, now, user.email, name, action, opId, detail);

  if (b.op === "add") {
    const itemId = str(b.item_id, 40);
    const body = str(b.body, MAX_MEMO + 1).trim();
    const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : "連絡";
    if (!body) return Response.json({ error: "書く中身がありません" }, { status: 400 });
    if (body.length > MAX_MEMO) return Response.json({ error: `メモは${MAX_MEMO}字までです` }, { status: 400 });
    const it = await db.prepare("SELECT id, drawing_no FROM items WHERE id = ?").bind(itemId).first<{ id: string; drawing_no: string }>();
    if (!it) return Response.json({ error: "品目が見つかりません（消されたかもしれません）" }, { status: 404 });
    const dup = await db.prepare("SELECT id FROM item_memos WHERE op_id = ? LIMIT 1").bind(opId).first();
    if (dup) return Response.json({ ok: true, same: true });
    const memo = { id: newId("m"), kind, body, created_at: now, created_by: user.email, created_name: name };
    let dnote: { id: string; drawing_no: string; body: string; saved_at: string; saved_name: string } | null = null;
    const stmts = [
      db
        .prepare("INSERT INTO item_memos (id, item_id, kind, body, created_at, created_by, created_name, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(memo.id, itemId, kind, body, now, user.email, name, opId),
      log("メモを書く", `${itemId}（${kind}）`),
    ];
    // 「品番の注意にも足す」：今の注意の最後に1行足す
    const dwg = it.drawing_no.trim();
    if (b.toDrawing === true && dwg) {
      const cur = await db
        .prepare("SELECT body FROM drawing_notes WHERE drawing_no = ? ORDER BY rowid DESC LIMIT 1")
        .bind(dwg)
        .first<{ body: string }>();
      const next = [cur?.body ?? "", body].filter(Boolean).join("\n").slice(0, MAX_NOTE);
      dnote = { id: newId("d"), drawing_no: dwg, body: next, saved_at: now, saved_name: name };
      stmts.push(
        db
          .prepare("INSERT INTO drawing_notes (id, drawing_no, body, saved_at, saved_by, saved_name, op_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(dnote.id, dwg, next, now, user.email, name, opId),
        log("品番の注意を直す", `${dwg}（メモから足す）`)
      );
    }
    stmts.push(db.prepare(VER));
    await db.batch(stmts);
    return Response.json({ ok: true, memo, dnote });
  }

  if (b.op === "cancel") {
    const id = str(b.id, 40);
    const m = await db.prepare("SELECT id, item_id, created_by, canceled_at FROM item_memos WHERE id = ?").bind(id).first<{ id: string; item_id: string; created_by: string; canceled_at: string }>();
    if (!m) return Response.json({ error: "メモが見つかりません" }, { status: 404 });
    if (m.canceled_at) return Response.json({ ok: true, same: true });
    if (m.created_by !== user.email && !isAdmin(user)) return Response.json({ error: "消せるのは書いた本人と管理者だけです" }, { status: 403 });
    await db.batch([
      db.prepare("UPDATE item_memos SET canceled_at = ?, canceled_by = ? WHERE id = ? AND canceled_at = ''").bind(now, user.email, id),
      log("メモを消す", `${m.item_id}（${id}）`),
      db.prepare(VER),
    ]);
    return Response.json({ ok: true });
  }

  if (b.op === "drawing") {
    const dwg = str(b.drawing_no, 200).trim();
    const body = str(b.body, MAX_NOTE + 1).trim();
    if (!dwg) return Response.json({ error: "図面番号が無いので、品番の注意は書けません" }, { status: 400 });
    if (body.length > MAX_NOTE) return Response.json({ error: `品番の注意は${MAX_NOTE}字までです` }, { status: 400 });
    const dup = await db.prepare("SELECT id FROM drawing_notes WHERE op_id = ? LIMIT 1").bind(opId).first();
    if (dup) return Response.json({ ok: true, same: true });
    const cur = await db.prepare("SELECT id, body FROM drawing_notes WHERE drawing_no = ? ORDER BY rowid DESC LIMIT 1").bind(dwg).first<{ id: string; body: string }>();
    // 直している間にほかの人が直していたら、上書きしないで断る
    if ((cur?.id ?? "") !== str(b.base, 40)) {
      return Response.json({ error: "直している間に、ほかの人がこの品番の注意を直しました。画面を最新にしてから、もう一度直してください。" }, { status: 409 });
    }
    if ((cur?.body ?? "") === body) return Response.json({ ok: true, same: true });
    const dnote = { id: newId("d"), drawing_no: dwg, body, saved_at: now, saved_name: name };
    await db.batch([
      db
        .prepare("INSERT INTO drawing_notes (id, drawing_no, body, saved_at, saved_by, saved_name, op_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(dnote.id, dwg, body, now, user.email, name, opId),
      log("品番の注意を直す", dwg),
      db.prepare(VER),
    ]);
    return Response.json({ ok: true, dnote });
  }

  return Response.json({ error: "知らない操作です" }, { status: 400 });
}
