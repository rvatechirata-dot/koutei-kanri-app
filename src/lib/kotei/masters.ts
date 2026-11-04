/**
 * 基本の一覧（名寄せ：工程名・作業者・機械・外注先・顧客・不良の理由）と休日（4段目・サーバー側）。
 * きまりは試作（コード.gs の applyMaster_）と同じ：
 *   - 同じ種類の中で、名前や別の書き方が2つの項目に入っていたら断る。名前に「｜」は使えない。並びは数字
 *   - 画面を見ている間にほかの人が直していたら断る（行の印で比べる）
 *   - 保存したら、今ある案件（顧客・営業担当）と工程（工程名・機械・担当者／外注先・開始した人・完了した人・不良の理由）の名前もそろえる
 *   - 作業・出荷・実績記録の名前は書き換えない（集計で見るときにそろえる）
 */
import type { CaseRow, MasterRow, ProcRow } from "./types";
import { aliasList, masterMap, MASTER_KINDS, NO_NAME, normOne, type MasterMap } from "./rules";
import { nowJst } from "./time";

type Db = D1Database;
const SEP = "｜";

export class MasterError extends Error {}

export function masterMark(r: Pick<MasterRow, "kind" | "name" | "aliases" | "sort_order" | "unused" | "memo">): string {
  return [r.kind, r.name, r.aliases, r.sort_order, r.unused, r.memo].join("\u001f");
}

/** 工程の「担当者・外注先」は、社内の工程なら作業者・外注の工程なら外注先として名寄せする */
const PROC_FIELDS: [keyof ProcRow, string | null][] = [
  ["name", "工程名"],
  ["machine", "機械"],
  ["assignee", null],
  ["started_by", "作業者"],
  ["done_by", "作業者"],
  ["defect_reason", "不良の理由"],
];
const CASE_FIELDS: [keyof CaseRow, string][] = [
  ["customer", "顧客"],
  ["sales_rep", "作業者"],
];

export interface MasterList {
  rows: (MasterRow & { mark: string })[];
  /** 種類ごとに、今あるデータに出てくる書き方とその数（一覧に無い名前を見つけるため） */
  used: Record<string, Record<string, number>>;
  holidays: { date: string; memo: string }[];
}

export async function loadMasters(db: Db): Promise<MasterList> {
  const [m, c, p, w, h] = await db.batch([
    db.prepare("SELECT id, kind, name, aliases, sort_order, unused, memo FROM masters ORDER BY kind, CAST(sort_order AS REAL), name"),
    db.prepare("SELECT customer, sales_rep FROM cases"),
    db.prepare("SELECT in_out, name, machine, assignee, started_by, done_by, defect_reason FROM processes"),
    db.prepare("SELECT worker, machine, defect_reason FROM works WHERE canceled_at = ''"),
    db.prepare("SELECT date, memo FROM holidays ORDER BY date"),
  ]);
  const used: MasterList["used"] = {};
  MASTER_KINDS.forEach((k) => (used[k] = {}));
  const add = (kind: string, v: string) => {
    const s = String(v ?? "").trim();
    if (!s || NO_NAME.includes(s)) return;
    used[kind][s] = (used[kind][s] || 0) + 1;
  };
  (c.results as { customer: string; sales_rep: string }[]).forEach((r) => {
    add("顧客", r.customer);
    add("作業者", r.sales_rep);
  });
  (p.results as Record<string, string>[]).forEach((r) => {
    add("工程名", r.name);
    add("機械", r.machine);
    add(r.in_out === "外注" ? "外注先" : "作業者", r.assignee);
    add("作業者", r.started_by);
    add("作業者", r.done_by);
    add("不良の理由", r.defect_reason);
  });
  (w.results as Record<string, string>[]).forEach((r) => {
    add("作業者", r.worker);
    add("機械", r.machine);
    add("不良の理由", r.defect_reason);
  });
  return {
    rows: (m.results as unknown as MasterRow[]).map((r) => ({ ...r, mark: masterMark(r) })),
    used,
    holidays: h.results as { date: string; memo: string }[],
  };
}

export interface MasterPut {
  id: string;
  isNew: boolean;
  base: string; // 画面が見ていた行の印（新しいときは空）
  f: { kind: string; name: string; aliases: string; sort_order: string; unused: string; memo: string };
}

/** 足す・直す・名寄せ・外す。保存のあとの一覧で、今ある案件・工程の名前をそろえる */
export async function saveMasters(
  db: Db,
  d: { put: MasterPut[]; del: { id: string; base: string }[]; note: string },
  who: string,
  worker: string
): Promise<{ put: number; del: number; cases: number; procs: number }> {
  const now = nowJst();
  const [mq, cq, pq] = await db.batch([db.prepare("SELECT * FROM masters"), db.prepare("SELECT * FROM cases"), db.prepare("SELECT * FROM processes")]);
  const all = mq.results as unknown as MasterRow[];
  const byId: Record<string, MasterRow> = {};
  all.forEach((r) => (byId[r.id] = r));
  const errs: string[] = [];
  const gone = new Set<string>();
  d.del.forEach((x) => {
    const r = byId[x.id];
    if (!r) return void errs.push("一覧から外す名前が見つかりません（ほかの人が先に変えたかもしれません）");
    if (x.base !== masterMark(r)) return void errs.push(`「${r.name}」：画面を見ている間に、ほかの人が直しました。読み直してからもう一度してください`);
    gone.add(r.id);
  });
  const rows: MasterRow[] = [];
  d.put.forEach((x) => {
    const old = byId[x.id];
    const kind = x.f.kind.trim();
    const name = x.f.name.trim();
    if (!x.id) return void errs.push("IDがありません");
    if (x.isNew && old) return void errs.push(`「${name}」はもう保存されています（二重に押したかもしれません）`);
    if (!x.isNew && !old) return void errs.push(`「${name}」が一覧に見つかりません（ほかの人が先に外したかもしれません）`);
    if (old && x.base !== masterMark(old)) return void errs.push(`「${old.name}」：画面を見ている間に、ほかの人が直しました。読み直してからもう一度してください`);
    if (!(MASTER_KINDS as readonly string[]).includes(kind)) return void errs.push(`種類がおかしいです（${kind}）`);
    if (!name || NO_NAME.includes(name)) return void errs.push(`${kind}：名前を入れてください`);
    if (name.includes(SEP)) return void errs.push(`${name}：名前に「${SEP}」は使えません`);
    const r: MasterRow = {
      id: x.id,
      kind,
      name,
      aliases: aliasList(x.f.aliases)
        .filter((a) => a !== name && !NO_NAME.includes(a))
        .join(SEP),
      sort_order: x.f.sort_order.trim(),
      unused: x.f.unused === "1" ? "1" : "",
      memo: x.f.memo.trim(),
    };
    if (!/^(-?\d+(\.\d+)?)?$/.test(r.sort_order)) return void errs.push(`${name}：並びは数字で入れてください（${r.sort_order}）`);
    if (old && masterMark(old) === masterMark(r)) return;
    rows.push(r);
  });
  // 保存のあとの一覧で、同じ種類の中で名前・別の書き方がぶつからないか
  const putId = new Set(rows.map((r) => r.id));
  const after = all.filter((r) => !gone.has(r.id) && !putId.has(r.id)).concat(rows);
  const seen: Record<string, MasterRow> = {};
  after.forEach((r) =>
    [r.name, ...aliasList(r.aliases)].forEach((v) => {
      const key = r.kind + "\n" + v;
      const o = seen[key];
      if (o && o.id !== r.id) errs.push(`${r.kind}「${v}」が、「${o.name}」と「${r.name}」の両方に入っています`);
      seen[key] = r;
    })
  );
  if (errs.length) throw new MasterError([...new Set(errs)].join("\n"));

  // 今ある案件・工程の名前を、保存のあとの一覧でそろえる
  const map: MasterMap = masterMap(after);
  const caseRows: CaseRow[] = [];
  (cq.results as unknown as CaseRow[]).forEach((r) => {
    let ch = false;
    const x = { ...r };
    CASE_FIELDS.forEach(([f, kind]) => {
      const n = normOne(map, kind, x[f]);
      if (n !== x[f]) {
        x[f] = n;
        ch = true;
      }
    });
    if (ch) caseRows.push(x);
  });
  const procRows: ProcRow[] = [];
  (pq.results as unknown as ProcRow[]).forEach((r) => {
    let ch = false;
    const x = { ...r };
    PROC_FIELDS.forEach(([f, kind]) => {
      const k = kind ?? (x.in_out === "外注" ? "外注先" : "作業者");
      const n = normOne(map, k, x[f]);
      if (n !== x[f]) {
        x[f] = n;
        ch = true;
      }
    });
    if (ch) procRows.push(x);
  });

  const stmts: D1PreparedStatement[] = [];
  const bulk = (table: string, list: Record<string, string>[]) => {
    if (!list.length) return;
    const cols = Object.keys(list[0]);
    for (let i = 0; i < list.length; i += 500) {
      stmts.push(
        db
          .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`)
          .bind(JSON.stringify(list.slice(i, i + 500)))
      );
    }
  };
  bulk("masters", rows.map((r) => ({ ...r, updated_at: now, updated_by: who })) as unknown as Record<string, string>[]);
  if (gone.size) stmts.push(db.prepare("DELETE FROM masters WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...gone])));
  bulk("cases", caseRows as unknown as Record<string, string>[]);
  bulk("processes", procRows as unknown as Record<string, string>[]);
  if (stmts.length) {
    const op = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const detail = `${d.note.trim() || "一覧を直した"}（書き換え：工程 ${procRows.length}行・案件 ${caseRows.length}行）`;
    stmts.push(
      db.prepare("INSERT INTO action_log (at, recorded_at, account, worker, action, op_id, detail) VALUES (?, ?, ?, ?, '基本の一覧', ?, ?)").bind(now, now, who, worker, op, detail),
      db.prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, 'edit', 'master', ?, ?)").bind(now, who, op, detail),
      db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'")
    );
    await db.batch(stmts);
  }
  return { put: rows.length, del: gone.size, cases: caseRows.length, procs: procRows.length };
}

/** 休日を1日ずつ足す・外す（土日は書かなくても休み） */
export async function saveHolidays(db: Db, d: { put: { date: string; memo: string }[]; del: string[] }, who: string, worker: string): Promise<void> {
  const now = nowJst();
  const bad = d.put.filter((x) => !/^\d{4}\/\d{2}\/\d{2}$/.test(x.date));
  if (bad.length) throw new MasterError(`日付の形がおかしいです（${bad.map((x) => x.date).join("・")}）。2026/12/29 の形で入れてください`);
  if (!d.put.length && !d.del.length) return;
  const stmts: D1PreparedStatement[] = [];
  d.put.forEach((x) => stmts.push(db.prepare("INSERT OR REPLACE INTO holidays (date, memo) VALUES (?, ?)").bind(x.date, x.memo.trim())));
  d.del.forEach((x) => stmts.push(db.prepare("DELETE FROM holidays WHERE date = ?").bind(x)));
  const detail = [d.put.length ? "足す " + d.put.map((x) => x.date).join("・") : "", d.del.length ? "外す " + d.del.join("・") : ""].filter(Boolean).join(" ／ ");
  stmts.push(
    db.prepare("INSERT INTO action_log (at, recorded_at, account, worker, action, op_id, detail) VALUES (?, ?, ?, ?, '休日の一覧', ?, ?)").bind(now, now, who, worker, "h" + Date.now().toString(36), detail),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'")
  );
  await db.batch(stmts);
}
