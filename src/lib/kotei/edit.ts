/**
 * 案件の登録・修正・ごみ箱へ・ごみ箱から戻す（4段目・サーバー側）。きまりは試作（コード.gs の applyEdit_）と同じ：
 *   - 画面で直せる欄だけ書き換える（開始・完了の日時や完成数量、エムネットの枠などは今の値のまま残す）
 *   - 画面を開いている間にほかの人が変えていたら断る（直せる欄の印で比べる）
 *   - 社内管理番号は必ず。品目は図面番号か品名のどちらかが必ず。日付・数字の形。工程は名前・社内か外注・開始予定 ≦ 納期
 *   - 画面から消した品目は、ごみ箱へ入れてから消す。案件をごみ箱へ入れると、その品目・工程も一緒に入る
 *   - 画面で登録した品目は「登録元＝この画面」（エムネットに無いので、取り込みの「CSVにない」に出ない）
 *   - バーコード番号は保存のときに付ける：頭「20」＋10桁の連番＋チェック数字（JAN）。ほかの品目と同じなら次へ進む
 *   - ごみ箱から戻すとき、同じバーコード番号の品目が今もあれば断る
 * ⚠ エムネットから来た品目を画面で直しても、次のCSV取り込みでエムネットの中身に戻る（「変わる」に出る）。
 */
import type { CaseRow, ItemRow, ProcRow } from "./types";
import { nowJst } from "./time";

type Db = D1Database;

export const EDIT_A = ["mgmt_no", "sales_rep", "customer_po", "customer", "customer_contact", "order_date", "bulk_due", "note", "annotation", "hidden"] as const;
export const EDIT_I = ["kubun", "kubun2", "ext_barcode", "drawing_no", "name", "unit_price", "qty", "final_due", "knowhow", "note", "hidden"] as const;
export const EDIT_P = ["in_out", "name", "assignee", "machine", "plan_start", "due", "unit_price", "std_time", "note"] as const;
const BC_HEAD = "20"; // 画面で付けるバーコード番号の頭（エムネットの番号は 1334… なので、ぶつからない。試作と同じ）

export class EditError extends Error {}

export type CaseEdit = Pick<CaseRow, (typeof EDIT_A)[number]>;
export type ItemEdit = Pick<ItemRow, (typeof EDIT_I)[number]>;
export type ProcEdit = Pick<ProcRow, (typeof EDIT_P)[number]>;

export interface CaseDoc {
  case: CaseRow;
  items: (ItemRow & { procs: ProcRow[] })[];
  base: string;
}

const pick = <T extends Record<string, string>, K extends readonly (keyof T)[]>(r: T, keys: K) => keys.map((k) => r[k] ?? "");

function baseOf(a: CaseRow, items: ItemRow[], procs: ProcRow[]): string {
  const PI: Record<string, ProcRow[]> = {};
  procs.forEach((p) => (PI[p.item_id] ||= []).push(p));
  const its = items.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
  return JSON.stringify([
    pick(a as unknown as Record<string, string>, EDIT_A),
    its.map((i) => [
      i.id,
      pick(i as unknown as Record<string, string>, EDIT_I),
      (PI[i.id] ?? []).slice().sort((x, y) => Number(x.seq) - Number(y.seq) || (x.id < y.id ? -1 : 1)).map((p) => [p.id, pick(p as unknown as Record<string, string>, EDIT_P)]),
    ]),
  ]);
}

async function loadCase(db: Db, aid: string) {
  const [a, i, p] = await db.batch([
    db.prepare("SELECT * FROM cases WHERE id = ?").bind(aid),
    db.prepare("SELECT * FROM items WHERE case_id = ?").bind(aid),
    db.prepare("SELECT p.* FROM processes p JOIN items i ON i.id = p.item_id WHERE i.case_id = ?").bind(aid),
  ]);
  return { a: (a.results as unknown as CaseRow[])[0] ?? null, items: i.results as unknown as ItemRow[], procs: p.results as unknown as ProcRow[] };
}

export async function getCase(db: Db, aid: string): Promise<CaseDoc | null> {
  const c = await loadCase(db, aid);
  if (!c.a) return null;
  const PI: Record<string, ProcRow[]> = {};
  c.procs.forEach((p) => (PI[p.item_id] ||= []).push(p));
  return {
    case: c.a,
    items: c.items
      .slice()
      .sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((i) => ({ ...i, procs: (PI[i.id] ?? []).sort((x, y) => Number(x.seq) - Number(y.seq)) })),
    base: baseOf(c.a, c.items, c.procs),
  };
}

/** 案件の一覧（さがす用）。品目の数・最終納期の早いもの */
export async function listCases(db: Db): Promise<{ id: string; mgmt_no: string; customer: string; customer_po: string; items: number; due: string; drawings: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.mgmt_no, c.customer, c.customer_po, COUNT(i.id) AS items, MIN(NULLIF(i.final_due, '')) AS due, GROUP_CONCAT(i.drawing_no, ' ') AS drawings
         FROM cases c LEFT JOIN items i ON i.case_id = c.id GROUP BY c.id ORDER BY c.mgmt_no`
    )
    .all<{ id: string; mgmt_no: string; customer: string; customer_po: string; items: number; due: string | null; drawings: string | null }>();
  return results.map((r) => ({ ...r, due: r.due ?? "", drawings: r.drawings ?? "" }));
}

/** 「前回の並びを写す」：同じ図面番号のいちばん新しい品目の工程の並び（予定日は空にする） */
export async function lastProcsOf(db: Db, dw: string, exceptItem: string): Promise<ProcEdit[]> {
  const it = await db
    .prepare("SELECT id FROM items WHERE drawing_no = ? AND id <> ? ORDER BY updated_at DESC, id DESC LIMIT 1")
    .bind(dw, exceptItem)
    .first<{ id: string }>();
  if (!it) return [];
  const { results } = await db.prepare("SELECT * FROM processes WHERE item_id = ? ORDER BY CAST(seq AS REAL)").bind(it.id).all<ProcRow>();
  return results.map((p) => ({ in_out: p.in_out, name: p.name, assignee: p.assignee, machine: p.machine, plan_start: "", due: "", unit_price: p.unit_price, std_time: p.std_time, note: p.note }));
}

function bcCheck(s12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s12.charAt(i)) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export interface SaveInput {
  aid: string;
  isNew: boolean;
  base: string;
  a: CaseEdit;
  items: { id: string; isNew: boolean; f: ItemEdit; procs: { id: string; isNew: boolean; f: ProcEdit }[] }[];
}

const okDate = (v: string) => v === "" || /^\d{4}\/\d{2}\/\d{2}( \d{2}:\d{2})?$/.test(v);
const okNum = (v: string) => v === "" || /^-?\d+(\.\d+)?$/.test(v);

function trashRow(bundle: string, k: number, kind: string, a: CaseRow | null, i: ItemRow | null, ps: ProcRow[], who: string, now: string) {
  return {
    id: `${bundle}-${k}`,
    bundle,
    kind,
    case_id: a?.id ?? i?.case_id ?? "",
    item_id: i?.id ?? "",
    title: [a?.mgmt_no, i?.drawing_no, i?.name].filter(Boolean).join(" "),
    deleted_at: now,
    deleted_by: who,
    content_json: JSON.stringify({ A: a, I: i, P: ps }),
  };
}

function bulkInsert(db: Db, table: string, rows: Record<string, unknown>[]): D1PreparedStatement[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  return [
    db
      .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`)
      .bind(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))))),
  ];
}
const deleteIn = (db: Db, table: string, col: string, ids: string[]) =>
  ids.length ? [db.prepare(`DELETE FROM ${table} WHERE ${col} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids))] : [];

export async function saveCase(db: Db, d: SaveInput, who: string, worker: string): Promise<{ aid: string; newBarcodes: string[] }> {
  const now = nowJst();
  const op = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cur = await loadCase(db, d.aid);
  if (!d.aid) throw new EditError("案件IDがありません");
  if (d.isNew && cur.a) throw new EditError("この案件はもう保存されています（二重に押したかもしれません）");
  if (!d.isNew && !cur.a) throw new EditError("この案件が見つかりません（ごみ箱に入ったか、CSVの取り込みで消えたかもしれません）");
  if (!d.isNew && baseOf(cur.a!, cur.items, cur.procs) !== d.base)
    throw new EditError("画面を開いている間に、ほかの人がこの案件を変えました（CSVの取り込みや、予定の変更も含みます）。読み直してから直してください");
  const errs: string[] = [];
  const no = d.a.mgmt_no.trim();
  if (!no) errs.push("社内管理番号を入れてください");
  (["order_date", "bulk_due"] as const).forEach((h) => {
    if (!okDate(d.a[h].trim())) errs.push(`${h === "order_date" ? "受注日" : "一括納期"}の形がおかしいです（${d.a[h]}）`);
  });
  const ar: CaseRow = { ...(cur.a ?? { id: d.aid, link: "", updated_at: "", updated_by: "" }), id: d.aid } as CaseRow;
  EDIT_A.forEach((h) => (ar[h] = (d.a[h] ?? "").trim()));
  ar.hidden = ar.hidden === "1" ? "1" : "";
  const aChanged = !cur.a || EDIT_A.some((h) => (cur.a![h] || "") !== ar[h]);
  if (aChanged) {
    ar.updated_at = now;
    ar.updated_by = who;
  }
  const I: Record<string, ItemRow> = {};
  cur.items.forEach((i) => (I[i.id] = i));
  const allProcs = await db.prepare("SELECT * FROM processes WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(d.items.flatMap((x) => x.procs.map((y) => y.id)))).all<ProcRow>();
  const P: Record<string, ProcRow> = {};
  allProcs.results.forEach((p) => (P[p.id] = p));
  const PI: Record<string, ProcRow[]> = {};
  cur.procs.forEach((p) => (PI[p.item_id] ||= []).push(p));
  const putI: ItemRow[] = [];
  const putP: ProcRow[] = [];
  const delP: string[] = [];
  const logs: { item: string; action: string; detail: string }[] = [];
  const keepI = new Set<string>();
  d.items.forEach((x, k) => {
    const old = I[x.id];
    const tag = `品目${k + 1}：`;
    if (!x.id) return void errs.push(tag + "IDがありません");
    if (!old && !x.isNew) return void errs.push(tag + "見つかりません（ごみ箱に入ったか、取り込みで消えたかもしれません）");
    if (old && x.isNew) return void errs.push(tag + "もう保存されています（二重に押したかもしれません）");
    keepI.add(x.id);
    const r: ItemRow = {
      ...(old ?? { barcode: "", link: "", delivery_json: "", updated_at: "", updated_by: "", source: "この画面" }),
      id: x.id,
      case_id: d.aid,
    } as ItemRow;
    EDIT_I.forEach((h) => (r[h] = (x.f[h] ?? "").trim()));
    r.hidden = r.hidden === "1" ? "1" : "";
    if (!r.drawing_no && !r.name) errs.push(tag + "図面番号か品名を入れてください");
    if (!okNum(r.qty)) errs.push(`${tag}数量が数字ではありません（${r.qty}）`);
    if (!okNum(r.unit_price)) errs.push(`${tag}単価が数字ではありません（${r.unit_price}）`);
    if (!okDate(r.final_due)) errs.push(`${tag}最終納期の形がおかしいです（${r.final_due}）`);
    const what: string[] = [];
    const keepP = new Set<string>();
    let pChanged = false;
    x.procs.forEach((y, n) => {
      const op0 = P[y.id];
      const name = y.f.name.trim() || "（名前なし）";
      if (!y.id) return void errs.push(tag + "工程にIDがありません");
      if (op0 && op0.item_id !== x.id) return void errs.push(`${tag}${name}：ほかの品目の工程です`);
      if (!op0 && !y.isNew) return void errs.push(`${tag}${name}：見つかりません（取り込みで消えたかもしれません）`);
      keepP.add(y.id);
      const pr: ProcRow = {
        ...(op0 ?? {
          mnet_slot: "", started_at: "", done_at: "", done_qty: "", inspected_on: "", inspector: "", extra_json: "",
          started_by: "", done_by: "", defect_qty: "", comment: "", defect_reason: "",
        }),
        id: y.id,
        item_id: x.id,
        seq: String(n + 1),
      } as ProcRow;
      EDIT_P.forEach((h) => (pr[h] = (y.f[h] ?? "").trim()));
      if (!y.f.name.trim()) errs.push(`${tag}${n + 1}番目の工程の名前を入れてください`);
      if (pr.in_out !== "社内" && pr.in_out !== "外注") errs.push(`${tag}${name}：社内か外注かを選んでください`);
      if (!okDate(pr.plan_start) || !okDate(pr.due)) errs.push(`${tag}${name}：日付の形がおかしいです`);
      else if (pr.plan_start && pr.due && pr.plan_start.slice(0, 10) > pr.due.slice(0, 10)) errs.push(`${tag}${name}：開始予定が納期より後になっています`);
      if (!okNum(pr.unit_price) || !okNum(pr.std_time)) errs.push(`${tag}${name}：単価か基準時間が数字ではありません`);
      if (!op0 || (Object.keys(pr) as (keyof ProcRow)[]).some((c) => (pr[c] ?? "") !== (op0[c] ?? ""))) {
        putP.push(pr);
        pChanged = true;
      }
    });
    (PI[x.id] ?? []).forEach((p) => {
      if (!keepP.has(p.id)) {
        delP.push(p.id);
        pChanged = true;
        what.push("工程を消す " + p.name);
      }
    });
    const iChanged = !old || EDIT_I.some((h) => (old[h] || "") !== r[h]);
    if (iChanged || pChanged || !r.barcode) {
      r.updated_at = now;
      r.updated_by = who;
      putI.push(r);
      logs.push({ item: x.id, action: old ? "品目の修正" : "品目の登録", detail: [no, r.drawing_no, iChanged && old ? "品目の欄" : "", pChanged ? "工程の並び" : "", ...what].filter(Boolean).join(" ・ ") });
    }
  });
  // 画面から消した品目は、ごみ箱へ
  const gone = cur.items.filter((i) => !keepI.has(i.id));
  const bundle = "Z" + op;
  const trash = gone.map((i, k) => trashRow(bundle, k + 1, "品目を消した", cur.a, i, PI[i.id] ?? [], who, now));
  gone.forEach((i) => {
    (PI[i.id] ?? []).forEach((p) => delP.push(p.id));
    logs.push({ item: i.id, action: "ごみ箱へ", detail: `${no} の品目を消した` });
  });
  if (errs.length) throw new EditError([...new Set(errs)].join("\n"));

  // バーコード番号を付ける（保存のとき）
  const newBarcodes: string[] = [];
  const needBc = putI.filter((r) => !r.barcode);
  let ctr = 0;
  if (needBc.length) {
    const s = await db.prepare("SELECT value FROM settings WHERE key = 'next_barcode'").first<{ value: string }>();
    ctr = Number(s?.value) || 1;
    for (const r of needBc) {
      for (;;) {
        const n = String(ctr++);
        if (n.length > 12 - BC_HEAD.length) throw new EditError(`バーコード番号を使い切りました（頭 ${BC_HEAD}）`);
        const s12 = BC_HEAD + n.padStart(12 - BC_HEAD.length, "0");
        const code = s12 + bcCheck(s12);
        const hit = await db.prepare("SELECT 1 FROM items WHERE barcode = ?").bind(code).first();
        if (!hit && !newBarcodes.includes(code)) {
          r.barcode = code;
          newBarcodes.push(code);
          break;
        }
      }
    }
  }
  if (!logs.length) logs.push({ item: "", action: d.isNew ? "案件の登録" : "案件の修正", detail: no + (aChanged ? "" : "（変わったところなし）") });

  const stmts: D1PreparedStatement[] = [
    ...(aChanged ? bulkInsert(db, "cases", [ar as unknown as Record<string, unknown>]) : []),
    ...bulkInsert(db, "items", putI as unknown as Record<string, unknown>[]),
    ...bulkInsert(db, "processes", putP as unknown as Record<string, unknown>[]),
    ...deleteIn(db, "processes", "id", delP),
    ...bulkInsert(db, "trash", trash),
    ...deleteIn(db, "items", "id", gone.map((i) => i.id)),
    ...logs.map((l) =>
      db
        .prepare("INSERT INTO action_log (at, recorded_at, account, worker, item_id, action, op_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(now, now, who, worker, l.item, l.action, op, l.detail)
    ),
    db
      .prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, ?, 'case', ?, ?)")
      .bind(now, who, d.isNew ? "create" : "edit", d.aid, logs.map((l) => `${l.action}：${l.detail}`).join(" ／ ").slice(0, 500)),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"),
  ];
  if (needBc.length) stmts.push(db.prepare("UPDATE settings SET value = ? WHERE key = 'next_barcode'").bind(String(ctr)));
  await db.batch(stmts);
  return { aid: d.aid, newBarcodes };
}

/** 案件をごみ箱へ（品目・工程も一緒に） */
export async function trashCase(db: Db, aid: string, base: string, who: string, worker: string): Promise<void> {
  const now = nowJst();
  const op = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const c = await loadCase(db, aid);
  if (!c.a) throw new EditError("この案件が見つかりません（もうごみ箱に入っているかもしれません）");
  if (baseOf(c.a, c.items, c.procs) !== base) throw new EditError("画面を開いている間に、ほかの人がこの案件を変えました。読み直してから、もう一度ごみ箱に入れてください");
  const PI: Record<string, ProcRow[]> = {};
  c.procs.forEach((p) => (PI[p.item_id] ||= []).push(p));
  const bundle = "Z" + op;
  const rows = c.items.length
    ? c.items.map((i, k) => trashRow(bundle, k + 1, "案件を消した", c.a, i, PI[i.id] ?? [], who, now))
    : [trashRow(bundle, 1, "案件を消した", c.a, null, [], who, now)];
  await db.batch([
    ...bulkInsert(db, "trash", rows),
    ...deleteIn(db, "processes", "id", c.procs.map((p) => p.id)),
    ...deleteIn(db, "items", "id", c.items.map((i) => i.id)),
    db.prepare("DELETE FROM cases WHERE id = ?").bind(aid),
    db
      .prepare("INSERT INTO action_log (at, recorded_at, account, worker, item_id, action, op_id, detail) VALUES (?, ?, ?, ?, ?, 'ごみ箱へ', ?, ?)")
      .bind(now, now, who, worker, c.items[0]?.id ?? "", op, `${c.a.mgmt_no}（品目${c.items.length}）`),
    db
      .prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, 'delete', 'case', ?, ?)")
      .bind(now, who, aid, `ごみ箱へ：${c.a.mgmt_no}（品目${c.items.length}）`),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"),
  ]);
}

export async function listTrash(db: Db) {
  const { results } = await db
    .prepare("SELECT bundle, kind, MIN(title) AS title, COUNT(*) AS n, MAX(deleted_at) AS deleted_at, MAX(deleted_by) AS deleted_by FROM trash GROUP BY bundle ORDER BY MAX(deleted_at) DESC LIMIT 200")
    .all<{ bundle: string; kind: string; title: string; n: number; deleted_at: string; deleted_by: string }>();
  return results;
}

/** ごみ箱から戻す（束ごと）。同じバーコード番号の品目が今もあれば断る */
export async function restoreTrash(db: Db, bundle: string, who: string, worker: string): Promise<void> {
  const now = nowJst();
  const op = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const { results: rows } = await db.prepare("SELECT * FROM trash WHERE bundle = ?").bind(bundle).all<{ id: string; title: string; content_json: string }>();
  if (!rows.length) throw new EditError("ごみ箱に見つかりません（ほかの人が先に戻したかもしれません）");
  const errs: string[] = [];
  const putA: CaseRow[] = [];
  const putI: ItemRow[] = [];
  const putP: ProcRow[] = [];
  const seenA = new Set<string>();
  for (const z of rows) {
    let c: { A: CaseRow | null; I: ItemRow | null; P: ProcRow[] } | null = null;
    try {
      c = JSON.parse(z.content_json);
    } catch {
      errs.push(`${z.title}：中身を読めません`);
      continue;
    }
    if (!c || (c.A && Array.isArray(c.A)) || (c.I && Array.isArray(c.I))) {
      errs.push(`${z.title}：試作のときの形の中身なので、ここでは戻せません`);
      continue;
    }
    if (c.A && !seenA.has(c.A.id)) {
      seenA.add(c.A.id);
      const have = await db.prepare("SELECT 1 FROM cases WHERE id = ?").bind(c.A.id).first();
      if (!have) putA.push(c.A);
    }
    if (c.I) {
      if (await db.prepare("SELECT 1 FROM items WHERE id = ?").bind(c.I.id).first()) {
        errs.push(`${z.title}：もう戻っています`);
        continue;
      }
      if (c.I.barcode && (await db.prepare("SELECT 1 FROM items WHERE barcode = ?").bind(c.I.barcode).first())) {
        errs.push(`${z.title}：同じバーコード番号（${c.I.barcode}）の品目が今もあるので戻せません（取り込みで入り直したかもしれません）`);
        continue;
      }
      putI.push(c.I);
      putP.push(...(c.P ?? []));
    }
  }
  if (errs.length) throw new EditError(errs.join("\n"));
  await db.batch([
    ...bulkInsert(db, "cases", putA as unknown as Record<string, unknown>[]),
    ...bulkInsert(db, "items", putI as unknown as Record<string, unknown>[]),
    ...bulkInsert(db, "processes", putP as unknown as Record<string, unknown>[]),
    db.prepare("DELETE FROM trash WHERE bundle = ?").bind(bundle),
    db
      .prepare("INSERT INTO action_log (at, recorded_at, account, worker, item_id, action, op_id, detail) VALUES (?, ?, ?, ?, ?, 'ごみ箱から戻す', ?, ?)")
      .bind(now, now, who, worker, putI[0]?.id ?? "", op, rows[0].title),
    db
      .prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, 'edit', 'case', ?, ?)")
      .bind(now, who, bundle, `ごみ箱から戻す：${rows[0].title}（${rows.length}件）`),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"),
  ]);
}
