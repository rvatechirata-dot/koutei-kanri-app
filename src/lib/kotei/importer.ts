/**
 * エムネットの案件一覧CSVの取り込み（サーバー側）。
 *
 * 流れ：画面がCSVを読んで行（CsvRec）にする → previewImport で今のデータと比べて「新しい・変わる・変わらない・CSVにない」を返す
 *       → 人が確かめて「取り込む」→ commitImport でもう一度比べ直して、1回のまとまり（D1 の batch）で書く。
 * 比べ方は川﨑部長の試作（index.html の normRec・mergeRec・importStock・analyze・runImport）と同じ。試作と違うのは次の2点：
 *   - 比べるのも書くのもサーバー。途中で止まって半分だけ入ることが無い（batch はまとめて入るか、何も入らないか）。
 *   - D1 の書き込みの枠（1日10万行）を食わないよう、変わった品目の行だけ書く。たくさんの行は json_each でまとめて1文にする。
 */
import type { CaseRow, CsvRec, ItemRow, MasterRow, ProcRow, ProcText } from "./types";
import { CASE_LABEL, ITEM_LABEL, PROC_LABEL } from "./types";
import { masterMap, normOne, OLD_DUE, sortProcs, stockRole, type MasterMap } from "./rules";
import { nowJst } from "./time";

type Db = D1Database;

const A_CMP = Object.keys(CASE_LABEL) as (keyof typeof CASE_LABEL)[];
const I_CMP = Object.keys(ITEM_LABEL) as (keyof typeof ITEM_LABEL)[];
const P_CMP = Object.keys(PROC_LABEL) as ProcText[];
/** CSVが空でも、こちらに入っていれば消さない（現場が入れた実績を守る） */
const KEEP: ProcText[] = ["started_at", "done_at", "done_qty"];

const short = (s: string) => {
  s = String(s).replace(/\n/g, "⏎");
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
};

interface ExItem extends ItemRow {
  _a: CaseRow | null;
  _p: ProcRow[];
  _shipped: number; // 取り消していない出荷の合計
  _fromStock: boolean; // 「在庫から出した」出荷があるか
}

interface State {
  ver: string;
  nextNo: number;
  cases: Record<string, CaseRow>;
  items: ExItem[];
  byBc: Record<string, ExItem>;
  map: MasterMap;
}

async function loadState(db: Db): Promise<State> {
  const [s, c, i, p, m, sh] = await db.batch([
    db.prepare("SELECT key, value FROM settings"),
    db.prepare("SELECT * FROM cases"),
    db.prepare("SELECT * FROM items"),
    db.prepare("SELECT * FROM processes"),
    db.prepare("SELECT kind, name, aliases FROM masters"),
    db.prepare(
      "SELECT item_id, SUM(CAST(qty AS REAL)) AS shipped, MAX(from_stock = '1') AS from_stock FROM shipments WHERE canceled_at = '' GROUP BY item_id"
    ),
  ]);
  const set: Record<string, string> = {};
  (s.results as { key: string; value: string }[]).forEach((r) => {
    set[r.key] = r.value;
  });
  const cases: Record<string, CaseRow> = {};
  (c.results as unknown as CaseRow[]).forEach((r) => {
    cases[r.id] = r;
  });
  const procBy: Record<string, ProcRow[]> = {};
  (p.results as unknown as ProcRow[]).forEach((r) => {
    (procBy[r.item_id] ||= []).push(r);
  });
  const shipBy: Record<string, { shipped: number; from_stock: number }> = {};
  (sh.results as { item_id: string; shipped: number; from_stock: number }[]).forEach((r) => {
    shipBy[r.item_id] = r;
  });
  const items: ExItem[] = (i.results as unknown as ItemRow[]).map((r) => ({
    ...r,
    _a: cases[r.case_id] ?? null,
    _p: sortProcs(procBy[r.id] ?? []),
    _shipped: Number(shipBy[r.id]?.shipped) || 0,
    _fromStock: !!shipBy[r.id]?.from_stock,
  }));
  const byBc: Record<string, ExItem> = {};
  items.forEach((it) => {
    byBc[it.barcode] = it;
  });
  return {
    ver: set.ver ?? "1",
    nextNo: Number(set.next_no) || 1,
    cases,
    items,
    byBc,
    map: masterMap(m.results as unknown as MasterRow[]),
  };
}

/** CSVの名前を、基本の一覧の名寄せでそろえる（エムネットの書き方のまま比べると、毎日「変わる」に出るため） */
function normRec(rec: CsvRec, map: MasterMap, cnt: Record<string, number>): CsvRec {
  const fix = (o: Record<string, string>, h: string, kind: string) => {
    const v = o[h] || "";
    const n = normOne(map, kind, v);
    if (n !== v) {
      o[h] = n;
      const k = `${kind}：${v}→${n}`;
      cnt[k] = (cnt[k] || 0) + 1;
    }
  };
  const r: CsvRec = { line: rec.line, a: { ...rec.a }, i: { ...rec.i }, p: rec.p.map((x) => ({ ...x })) };
  fix(r.a as unknown as Record<string, string>, "customer", "顧客");
  fix(r.a as unknown as Record<string, string>, "sales_rep", "作業者");
  r.p.forEach((p) => {
    const o = p as unknown as Record<string, string>;
    fix(o, "name", "工程名");
    fix(o, "machine", "機械");
    fix(o, "assignee", p.in_out === "外注" ? "外注先" : "作業者");
  });
  return r;
}

type NewProc = Omit<ProcRow, "item_id">;

/** 今ある品目にCSVの中身を重ねる。工程は「エムネットの枠」で突き合わせる */
function mergeRec(rec: CsvRec, ex: ExItem | undefined): { procs: NewProc[]; ch: string[] } {
  const ch: string[] = [];
  if (ex) {
    I_CMP.forEach((h) => {
      if ((ex[h] || "") !== rec.i[h])
        ch.push(ITEM_LABEL[h] + "：" + (h === "delivery_json" ? "変更" : short(ex[h] || "空") + " → " + short(rec.i[h] || "空")));
    });
    const exA = ex._a;
    A_CMP.forEach((h) => {
      if (exA && (exA[h] || "") !== rec.a[h]) ch.push("案件の" + CASE_LABEL[h] + "：" + short(exA[h] || "空") + " → " + short(rec.a[h] || "空"));
    });
  }
  const bySlot: Record<string, ProcRow> = {};
  (ex ? ex._p : []).forEach((p) => {
    bySlot[p.mnet_slot] = p;
  });
  const used: Record<string, boolean> = {};
  const procs = rec.p.map((np) => {
    const old = bySlot[np.mnet_slot];
    const p: NewProc = { ...np, id: old ? old.id : "", started_by: "", done_by: "", defect_qty: "", comment: "", defect_reason: "" };
    if (old) {
      used[np.mnet_slot] = true;
      KEEP.forEach((h) => {
        if (!p[h as keyof NewProc] && old[h]) (p as unknown as Record<string, string>)[h] = old[h];
      });
      // この画面で押した人は、日時が同じ間だけ残す（エムネットで別の日時になったら、押した人は分からないので空にする）
      p.started_by = p.started_at === old.started_at ? old.started_by || "" : "";
      p.done_by = p.done_at === old.done_at ? old.done_by || "" : "";
      // エムネットに無い欄なので、この画面の中身を残す
      p.defect_qty = old.defect_qty || "";
      p.comment = old.comment || "";
      p.defect_reason = old.defect_reason || "";
      p.lane_order = old.lane_order ?? null; // ボードの加工順もこの画面の中身なので残す
      const diff = P_CMP.filter((h) => (old[h] || "") !== ((p as unknown as Record<string, string>)[h] || ""));
      if (diff.length)
        ch.push(
          "工程 " +
            p.name +
            "：" +
            diff
              .map((h) =>
                h === "extra_json"
                  ? "外注の詳しい内容"
                  : PROC_LABEL[h] + " " + short(old[h] || "空") + "→" + short((p as unknown as Record<string, string>)[h] || "空")
              )
              .join("、")
        );
    } else if (ex) ch.push("工程を足す：" + p.name);
    return p;
  });
  if (ex)
    ex._p.forEach((p) => {
      if (!used[p.mnet_slot]) ch.push("工程を消す：" + p.name);
    });
  return { procs, ch };
}

interface StockEvent {
  type: "prod" | "ship";
  p: NewProc;
  q: number;
}

/**
 * 取り込みで、エムネットで押した完了が新しく入ったときの在庫の動き。今ある品目だけ（初めて入る品目は作らない）。
 *   製品になる工程（出荷の1つ手前）が終わった → 製品が増える。出荷の工程が終わった → 出荷を記録して製品が減る（数は品目の数量の残り）
 */
function importStock(rec: CsvRec, ex: ExItem, procs: NewProc[]): StockEvent[] {
  const withId = procs.map((p, k) => ({ ...p, id: p.id || "new" + k }));
  const role = stockRole(rec.i.kubun, sortProcs(withId));
  if (!role) return [];
  const old: Record<string, ProcRow> = {};
  ex._p.forEach((p) => {
    old[p.id] = p;
  });
  const out: StockEvent[] = [];
  procs.forEach((p) => {
    const o = old[p.id];
    if (!p.id || !o || o.done_at || !p.done_at) return;
    if (p.id === role.prod && !ex._fromStock) {
      const q = Number(p.done_qty) || Number(rec.i.qty) || 0;
      if (q) out.push({ type: "prod", p, q });
    }
    if (p.id === role.ship) {
      const q = Math.max(0, (Number(rec.i.qty) || 0) - ex._shipped);
      if (q) out.push({ type: "ship", p, q });
    }
  });
  return out;
}

interface Entry {
  rec: CsvRec;
  ex?: ExItem;
  procs: NewProc[];
  ch: string[];
  old?: boolean;
  stock?: StockEvent[];
}

interface Analysis {
  add: Entry[];
  chg: Entry[];
  same: number;
  gone: ExItem[];
  mine: number;
  norm: Record<string, number>;
}

function analyze(recs: CsvRec[], st: State): Analysis {
  const norm: Record<string, number> = {};
  const out: Analysis = { add: [], chg: [], same: 0, gone: [], mine: 0, norm };
  const seen: Record<string, boolean> = {};
  recs.forEach((raw) => {
    const rec = normRec(raw, st.map, norm);
    seen[rec.i.barcode] = true;
    const ex = st.byBc[rec.i.barcode];
    const m = mergeRec(rec, ex);
    const e: Entry = { rec, ex, procs: m.procs, ch: m.ch };
    if (!ex) {
      e.old = !!(rec.i.final_due && rec.i.final_due < OLD_DUE && !rec.p.some((p) => p.done_at));
      out.add.push(e);
    } else if (m.ch.length) {
      e.stock = importStock(rec, ex, m.procs);
      out.chg.push(e);
    } else out.same++;
  });
  // この画面で登録した品目はエムネットに無いので、「CSVにない」には出さない
  st.items.forEach((it) => {
    if (it.source) {
      out.mine++;
      return;
    }
    if (!seen[it.barcode]) out.gone.push(it);
  });
  return out;
}

/** 画面に返す「比べた結果」（中身の行は返さず、確かめるのに要る項目だけ） */
export interface Preview {
  ver: string;
  add: { bc: string; line: number; mgmt_no: string; customer: string; drawing_no: string; name: string; final_due: string; procs: number; old: boolean }[];
  chg: { bc: string; mgmt_no: string; drawing_no: string; name: string; ch: string[]; stock: number }[];
  same: number;
  gone: { bc: string; mgmt_no: string; drawing_no: string; name: string; final_due: string; procs: number; done: number }[];
  mine: number;
  norm: Record<string, number>;
}

function toPreview(an: Analysis, ver: string): Preview {
  return {
    ver,
    add: an.add.map((e) => ({
      bc: e.rec.i.barcode,
      line: e.rec.line,
      mgmt_no: e.rec.a.mgmt_no,
      customer: e.rec.a.customer,
      drawing_no: e.rec.i.drawing_no,
      name: e.rec.i.name,
      final_due: e.rec.i.final_due,
      procs: e.procs.length,
      old: !!e.old,
    })),
    chg: an.chg.map((e) => ({
      bc: e.rec.i.barcode,
      mgmt_no: e.rec.a.mgmt_no,
      drawing_no: e.rec.i.drawing_no,
      name: e.rec.i.name,
      ch: e.ch,
      stock: e.stock?.length ?? 0,
    })),
    same: an.same,
    gone: an.gone.map((it) => ({
      bc: it.barcode,
      mgmt_no: it._a?.mgmt_no ?? "",
      drawing_no: it.drawing_no,
      name: it.name,
      final_due: it.final_due,
      procs: it._p.length,
      done: it._p.filter((p) => p.done_at).length,
    })),
    mine: an.mine,
    norm: an.norm,
  };
}

export async function previewImport(db: Db, recs: CsvRec[]): Promise<Preview> {
  const st = await loadState(db);
  return toPreview(analyze(recs, st), st.ver);
}

/** 人が選んだこと。skipAdd／skipChg＝取り込まない、takeOld＝古い案件でも入れる、gone＝「CSVにない」で消す（バーコード番号） */
export interface Choices {
  skipAdd: string[];
  skipChg: string[];
  takeOld: string[];
  gone: string[];
}

export class ImportConflict extends Error {}

/* ===== まとめて書く道具（json_each で1文に何行も） ===== */
const CHUNK_CHARS = 400_000; // 1つの文に渡すJSONの大きさの目安（D1の1つの値の上限より十分小さく）

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  rows.forEach((r) => {
    const n = JSON.stringify(r).length;
    if (cur.length && size + n > CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  });
  if (cur.length) out.push(cur);
  return out;
}

function insertRows(db: Db, table: string, cols: string[], rows: Record<string, unknown>[], verb = "INSERT OR REPLACE"): D1PreparedStatement[] {
  if (!rows.length) return [];
  const sel = cols.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  // 加工順（lane_order）は数か空（NULL）。それ以外は空なら ""
  return chunks(rows.map((r) => Object.fromEntries(cols.map((c) => [c, c === "lane_order" ? (r[c] ?? null) : (r[c] ?? "")])))).map((part) =>
    db.prepare(`${verb} INTO ${table} (${cols.join(", ")}) SELECT ${sel} FROM json_each(?)`).bind(JSON.stringify(part))
  );
}

function deleteIn(db: Db, table: string, col: string, ids: string[]): D1PreparedStatement[] {
  if (!ids.length) return [];
  return chunks(ids).map((part) => db.prepare(`DELETE FROM ${table} WHERE ${col} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(part)));
}

const CASE_COLS = ["id", ...A_CMP, "updated_at", "updated_by"];
const ITEM_COLS = ["id", "case_id", ...I_CMP, "updated_at", "updated_by", "source"];
const PROC_COLS = [
  "id", "item_id", "seq", "in_out", "mnet_slot", "name", "assignee", "machine", "plan_start", "due", "started_at", "done_at",
  "done_qty", "inspected_on", "inspector", "unit_price", "std_time", "note", "extra_json", "started_by", "done_by",
  "defect_qty", "comment", "defect_reason", "lane_order",
];
const SHIP_COLS = ["id", "item_id", "process_id", "ship_date", "qty", "note", "recorded_at", "account", "worker"];
const MV_COLS = ["id", "at", "recorded_at", "account", "worker", "drawing_no", "qty", "kind", "book", "item_id", "process_id", "shipment_id", "detail"];
const TRASH_COLS = ["id", "bundle", "kind", "case_id", "item_id", "title", "deleted_at", "deleted_by", "content_json"];

const fmtN = (n: number) => String(Math.round(n * 1000) / 1000);

export interface CommitResult {
  added: number;
  changed: number;
  deleted: number;
  stockMoves: number;
  ver: string;
}

/** 取り込む。ver（比べたときの更新番号）が今と違えば ImportConflict（間に誰かが変えたので比べ直してもらう） */
export async function commitImport(
  db: Db,
  p: { recs: CsvRec[]; ver: string; choices: Choices; file: string; email: string; opId: string }
): Promise<CommitResult> {
  const st = await loadState(db);
  if (st.ver !== p.ver) throw new ImportConflict("CSVを読んだあとに、ほかの人の取り込みや入力がありました。もう一度「比べる」からやり直してください。");
  const an = analyze(p.recs, st);
  const skipAdd = new Set(p.choices.skipAdd);
  const skipChg = new Set(p.choices.skipChg);
  const takeOld = new Set(p.choices.takeOld);
  const goneSel = new Set(p.choices.gone);
  const adds = an.add.filter((e) => (e.old ? takeOld.has(e.rec.i.barcode) : !skipAdd.has(e.rec.i.barcode)));
  const chgs = an.chg.filter((e) => !skipChg.has(e.rec.i.barcode));
  const gones = an.gone.filter((it) => goneSel.has(it.barcode));

  const now = nowJst();
  let seq = st.nextNo;
  const nid = (prefix: string) => prefix + String(seq++).padStart(6, "0");

  const caseByNo: Record<string, CaseRow> = {};
  Object.values(st.cases).forEach((a) => {
    if (!caseByNo[a.mgmt_no]) caseByNo[a.mgmt_no] = a;
  });
  const newCase: Record<string, string> = {};
  const casePut: Record<string, Record<string, unknown> | null> = {};
  const finalCase: Record<string, string> = {};
  const itemRows: Record<string, unknown>[] = [];
  const procRows: Record<string, unknown>[] = [];
  const replacedItems: string[] = [];

  adds.concat(chgs).forEach((e) => {
    const no = e.rec.a.mgmt_no;
    const aid = caseByNo[no] ? caseByNo[no].id : newCase[no] || (newCase[no] = nid("A"));
    if (!(aid in casePut)) {
      const exA = st.cases[aid];
      const changed = !exA || A_CMP.some((h) => (exA[h] || "") !== e.rec.a[h]);
      casePut[aid] = changed ? { ...e.rec.a, id: aid, updated_at: now, updated_by: p.email } : null;
    }
    const iid = e.ex ? e.ex.id : nid("I");
    finalCase[iid] = aid;
    itemRows.push({ ...e.rec.i, id: iid, case_id: aid, updated_at: now, updated_by: p.email, source: e.ex?.source ?? "" });
    if (e.ex) replacedItems.push(iid);
    e.procs.forEach((pr) => procRows.push({ ...pr, id: pr.id || nid("P"), item_id: iid }));
  });

  // エムネットで押した完了から、この画面の在庫の動き（製品が増える・出荷）を作る
  const shipRows: Record<string, unknown>[] = [];
  const mvRows: Record<string, unknown>[] = [];
  const by = "取り込み";
  chgs.forEach((e) =>
    (e.stock || []).forEach((x) => {
      const it = e.ex!;
      const doneAt = x.p.done_at.length > 10 ? x.p.done_at : x.p.done_at + " 00:00";
      const mv = (n: number, kind: string, sid: string, what: string) => ({
        id: nid("M"), at: doneAt, recorded_at: now, account: p.email, worker: by, drawing_no: e.rec.i.drawing_no,
        qty: fmtN(n), kind, book: "画面", item_id: it.id, process_id: x.p.id, shipment_id: sid, detail: what,
      });
      if (x.type === "prod") mvRows.push(mv(x.q, "取り込みの完了", "", `${e.rec.a.mgmt_no} ${x.p.name}（エムネットで完了）`));
      else {
        const sid = nid("S");
        shipRows.push({
          id: sid, item_id: it.id, process_id: x.p.id, ship_date: x.p.done_at.slice(0, 10), qty: fmtN(x.q),
          note: "エムネットで完了（取り込みで記録）", recorded_at: now, account: p.email, worker: by,
        });
        mvRows.push(mv(-x.q, "取り込みの出荷", sid, `${e.rec.a.mgmt_no} ${x.p.done_at.slice(0, 10)}（エムネットで完了）`));
      }
    })
  );

  // 「CSVにない」で消す品目は、ごみ箱へ入れてから消す。品目がひとつも無くなった案件も消す
  const delI = gones.map((g) => g.id);
  const delSet = new Set(delI);
  const alive = new Set<string>();
  st.items.forEach((it) => {
    if (!delSet.has(it.id)) alive.add(finalCase[it.id] || it.case_id);
  });
  Object.values(finalCase).forEach((id) => alive.add(id));
  const delA = Object.keys(st.cases).filter((id) => !alive.has(id));
  const bundle = "Z" + p.opId;
  const trashRows = gones.map((it, k) => ({
    id: `${bundle}-${k + 1}`,
    bundle,
    kind: "取り込みで消した",
    case_id: it.case_id,
    item_id: it.id,
    title: [it._a?.mgmt_no, it.drawing_no, it.name].filter(Boolean).join(" "),
    deleted_at: now,
    deleted_by: p.email,
    content_json: JSON.stringify({ A: it._a, I: stripEx(it), P: it._p }),
  }));

  const caseRows = Object.values(casePut).filter((x): x is Record<string, unknown> => !!x);
  const stmts: D1PreparedStatement[] = [
    ...insertRows(db, "cases", CASE_COLS, caseRows),
    ...insertRows(db, "items", ITEM_COLS, itemRows),
    ...deleteIn(db, "processes", "item_id", replacedItems),
    ...insertRows(db, "processes", PROC_COLS, procRows),
    ...insertRows(db, "shipments", SHIP_COLS, shipRows),
    ...insertRows(db, "stock_moves", MV_COLS, mvRows),
    ...insertRows(db, "trash", TRASH_COLS, trashRows),
    ...deleteIn(db, "processes", "item_id", delI),
    ...deleteIn(db, "items", "id", delI),
    ...deleteIn(db, "cases", "id", delA),
    db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"),
    db.prepare("UPDATE settings SET value = ? WHERE key = 'next_no'").bind(String(seq)),
    db
      .prepare("INSERT INTO import_history (at, account, file, added, changed, deleted, op_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(now, p.email, p.file, adds.length, chgs.length, gones.length, p.opId),
    db
      .prepare("INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, 'import', 'csv', ?, ?)")
      .bind(now, p.email, p.opId, `${p.file}：新しい ${adds.length}・変わった ${chgs.length}・消した ${gones.length}`),
  ];
  await db.batch(stmts);
  return { added: adds.length, changed: chgs.length, deleted: gones.length, stockMoves: mvRows.length, ver: String(Number(st.ver) + 1) };
}

function stripEx(it: ExItem): ItemRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _a, _p, _shipped, _fromStock, ...row } = it;
  return row;
}
