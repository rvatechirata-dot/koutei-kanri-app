/**
 * ガントで予定（開始予定・納期）を変える（4段目・サーバー側）。きまりは試作（コード.gs の applyPlan_）と同じ：
 *   画面が見ていた予定と今の予定が違う工程が1つでもあれば、何も変えずに断る（ほかの人や取り込みで先に変わっていたとき）。
 *   日付の形・開始予定 ≦ 納期 を確かめる。変えた工程ごとに実績記録へ「予定の変更」を残す。
 * 休日（holidays）と土日を数えないで後ろの工程をずらす計算は、画面（GanttView）でする。
 */
import { nowJst } from "./time";

type Db = D1Database;

export class PlanError extends Error {}

export interface PlanChange {
  pid: string;
  s: string; // 新しい開始予定
  e: string; // 新しい納期
  base: { s: string; e: string }; // 画面が見ていた予定
}

const okDate = (v: string) => v === "" || /^\d{4}\/\d{2}\/\d{2}( \d{2}:\d{2})?$/.test(v);

export async function applyPlan(db: Db, changes: PlanChange[], who: string, worker: string): Promise<number> {
  const now = nowJst();
  const op = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const { results } = await db
    .prepare("SELECT id, item_id, name, plan_start, due FROM processes WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(changes.map((c) => c.pid)))
    .all<{ id: string; item_id: string; name: string; plan_start: string; due: string }>();
  const rows: Record<string, (typeof results)[number]> = {};
  results.forEach((r) => (rows[r.id] = r));
  const errs: string[] = [];
  const plan: { r: (typeof results)[number]; s: string; e: string }[] = [];
  changes.forEach((x) => {
    const r = rows[x.pid];
    if (!r) return void errs.push("工程が見つかりません（CSVの取り込みで消えたかもしれません）");
    if (!okDate(x.s) || !okDate(x.e)) return void errs.push(`${r.name}：日付の形がおかしいです（${x.s}／${x.e}）`);
    if ((r.plan_start || "") !== (x.base.s || "") || (r.due || "") !== (x.base.e || "")) return void errs.push(`${r.name}：画面を見ている間に予定が変わっていたので、動かしませんでした`);
    if (x.s && x.e && x.s.slice(0, 10) > x.e.slice(0, 10)) return void errs.push(`${r.name}：開始予定が納期より後になります`);
    plan.push({ r, s: x.s, e: x.e });
  });
  if (errs.length) throw new PlanError(errs.join("\n"));
  const stmts: D1PreparedStatement[] = [];
  plan.forEach((p) => {
    if (p.r.plan_start === p.s && p.r.due === p.e) return;
    stmts.push(db.prepare("UPDATE processes SET plan_start = ?, due = ? WHERE id = ?").bind(p.s, p.e, p.r.id));
    const what = [p.r.plan_start !== p.s ? `開始予定 ${p.r.plan_start || "空"}→${p.s || "空"}` : "", p.r.due !== p.e ? `納期 ${p.r.due || "空"}→${p.e || "空"}` : ""].filter(Boolean).join("・");
    stmts.push(
      db
        .prepare("INSERT INTO action_log (at, recorded_at, account, worker, item_id, process_id, action, op_id, detail) VALUES (?, ?, ?, ?, ?, ?, '予定の変更', ?, ?)")
        .bind(now, now, who, worker, p.r.item_id, p.r.id, op, what)
    );
  });
  if (!stmts.length) return 0;
  const n = stmts.length / 2; // 工程1つにつき「予定を書き換える」と「実績記録」の2つ
  stmts.push(db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"));
  await db.batch(stmts);
  return n;
}
