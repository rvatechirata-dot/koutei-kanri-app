/**
 * 工程の開始・完了・取り消し・コメントと、工程の中の作業（2段目・サーバー側）。
 *
 * 中身は川﨑課長の試作（コード.gs の applyActs_）と同じきまりにしてある：
 *   - 先にほかの人が同じことをしていた（もう開始・もう完了）ときは、断らずに飛ばして skipped で知らせる
 *   - つじつまの合わない操作が1つでもあれば、何も書かずに断る（まとめて完了も全部まとめて）
 *   - 開始を押さずに完了したときは、開始も同じ時刻にする
 *   - 製品になる工程（出荷の1つ手前）の完了で製品が増える／取り消しで戻す。出荷の工程の完了は出荷を記録する
 *   - 作業の完成数・不良数の合計を、工程の完成数量・不良数に入れる（出荷の工程は出荷の合計なので変えない）
 * 試作と違う点：
 *   - 押した時刻はサーバーの時計（端末の時計がずれていても同じ時刻になる）。送信待ちの列（離れたところで押しためる）は持たない
 *   - 作業者はログインした人（共有メールのときだけ、一覧から選んだ人）。他人の名前では押せない
 *   - 同じ操作が2回届いたときは、実績記録の「操作の札」で見分けて1回分にする
 * 3段目：'ship'（分納＝工程は完了にせず出荷だけ記録。何回でも）・'unship'（出荷を取り消す。工程の完了はそのまま）。
 * エムネットの作業ログの取り込みは worklog.ts。
 */
import type { ProcRow } from "./types";
import { sortProcs, stockRole } from "./rules";
import { nowJst } from "./time";

type Db = D1Database;

export interface ShipInput {
  ship_date?: string;
  dest?: string;
  contact?: string;
  packages?: string;
  carrier?: string;
  slip_no?: string;
  time_spec?: string;
  note?: string;
  from_stock?: string;
}

export interface Act {
  op: "start" | "done" | "undoStart" | "undoDone" | "pMemo" | "wStart" | "wAdd" | "wEnd" | "wEdit" | "wUndo" | "ship" | "unship";
  pid?: string; // 工程ID
  sid?: string; // 出荷ID（unship）
  wid?: string; // 作業ID（wEnd・wEdit・wUndo）
  qty?: string; // 完成数量（良品）。出荷の工程の完了では今回出荷する数
  ng?: string; // 不良数
  memo?: string; // コメント
  why?: string; // 不良の理由
  mc?: string; // 機械
  s?: string; // 作業を直すときの開始日時
  e?: string; // 作業を直すときの終了日時
  base?: { s?: string; e?: string } | string; // 画面が見ていた開始・完了日時（工程）／作業の行の印（作業を直す）
  ship?: ShipInput; // 出荷の工程の完了のとき
}

export class ActError extends Error {}

interface WorkRow {
  id: string;
  item_id: string;
  process_id: string;
  worker: string;
  started_at: string;
  ended_at: string;
  good_qty: string;
  defect_qty: string;
  comment: string;
  source_key: string;
  recorded_at: string;
  account: string;
  canceled_at: string;
  canceled_by: string;
  op_id: string;
  machine: string;
  defect_reason: string;
}

/** 作業の行の印（画面が見ていた行と今の行が同じかを比べる） */
export function workMark(w: Pick<WorkRow, "started_at" | "ended_at" | "good_qty" | "defect_qty" | "comment" | "machine" | "defect_reason" | "canceled_at">): string {
  return [w.started_at, w.ended_at, w.good_qty, w.defect_qty, w.comment, w.machine, w.defect_reason, w.canceled_at].join("\u001f");
}

const txt = (v: unknown) => String(v ?? "").trim();
const okAt = (v: string) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(v);
const round = (n: number) => String(Math.round(n * 1000) / 1000);
const newId = (prefix: string) => prefix + "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const PROC_SET_COLS: (keyof ProcRow)[] = ["started_at", "started_by", "done_at", "done_by", "done_qty", "defect_qty", "comment", "defect_reason"];

export interface ActResult {
  skipped: string[];
  changed: number;
  dup?: boolean;
}

export async function applyActs(db: Db, p: { acts: Act[]; worker: string; account: string; opId: string; admin: boolean }): Promise<ActResult> {
  const { acts, worker, account: who, opId, admin } = p;
  if (!worker) throw new ActError("作業者が決まっていません。");
  if (!acts.length) throw new ActError("操作がありません。");
  if (acts.length > 500) throw new ActError("一度に押せるのは500件までです。");
  const dup = await db.prepare("SELECT 1 FROM action_log WHERE op_id = ? LIMIT 1").bind(opId).first();
  if (dup) return { skipped: [], changed: 0, dup: true };

  const now = nowJst();
  const when = now;

  // ── 読む：触る工程の品目の、工程ぜんぶ・品目・案件・出荷・在庫の動き・作業 ──
  const wids = acts.map((a) => txt(a.wid)).filter(Boolean);
  const wFound = wids.length
    ? ((await db.prepare("SELECT * FROM works WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(wids)).all<WorkRow>()).results)
    : [];
  const sids = acts.map((a) => txt(a.sid)).filter(Boolean);
  const sFound = sids.length
    ? (await db.prepare("SELECT id, process_id, canceled_at FROM shipments WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(sids)).all<{ id: string; process_id: string; canceled_at: string }>()).results
    : [];
  const pids = [...new Set([...acts.map((a) => txt(a.pid)).filter(Boolean), ...wFound.map((w) => w.process_id), ...sFound.map((s) => s.process_id)])];
  const seed = pids.length
    ? (await db.prepare("SELECT DISTINCT item_id FROM processes WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(pids)).all<{ item_id: string }>()).results
    : [];
  const iids = seed.map((r) => r.item_id);
  const J = JSON.stringify(iids);
  const [procQ, itemQ, shipQ, mvQ, workQ, logQ] = await db.batch([
    db.prepare("SELECT * FROM processes WHERE item_id IN (SELECT value FROM json_each(?))").bind(J),
    db.prepare(
      "SELECT i.id, i.kubun, i.drawing_no, i.qty, COALESCE(c.mgmt_no, '') AS mgmt_no FROM items i LEFT JOIN cases c ON c.id = i.case_id WHERE i.id IN (SELECT value FROM json_each(?))"
    ).bind(J),
    db.prepare("SELECT id, item_id, process_id, qty, from_stock, ship_date FROM shipments WHERE canceled_at = '' AND item_id IN (SELECT value FROM json_each(?))").bind(J),
    db.prepare("SELECT item_id, process_id, shipment_id, qty FROM stock_moves WHERE book = '画面' AND item_id IN (SELECT value FROM json_each(?))").bind(J),
    db.prepare("SELECT * FROM works WHERE item_id IN (SELECT value FROM json_each(?))").bind(J),
    db.prepare(
      "SELECT process_id, action, prev_started_at FROM action_log WHERE action IN ('完了', '完了の取り消し') AND process_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC"
    ).bind(JSON.stringify(pids)),
  ]);
  const rows: Record<string, ProcRow> = {};
  const byItem: Record<string, ProcRow[]> = {};
  (procQ.results as unknown as ProcRow[]).forEach((r) => {
    rows[r.id] = { ...r };
    (byItem[r.item_id] ||= []).push(rows[r.id]);
  });
  const items: Record<string, { id: string; kubun: string; drawing_no: string; qty: string; mgmt_no: string }> = {};
  (itemQ.results as unknown as (typeof items)[string][]).forEach((r) => {
    items[r.id] = r;
  });
  const ships = shipQ.results as unknown as { id: string; item_id: string; process_id: string; qty: string; from_stock: string; ship_date: string }[];
  const mvs = mvQ.results as unknown as { item_id: string; process_id: string; shipment_id: string; qty: string }[];
  const wAll = (workQ.results as unknown as WorkRow[]).map((w) => ({ ...w }));
  const lastDone: Record<string, { action: string; prev_started_at: string }> = {};
  (logQ.results as unknown as { process_id: string; action: string; prev_started_at: string }[]).forEach((l) => {
    if (!lastDone[l.process_id]) lastDone[l.process_id] = l;
  });

  const roles: Record<string, ReturnType<typeof stockRole>> = {};
  const roleOf = (iid: string) => {
    if (!(iid in roles)) roles[iid] = items[iid] ? stockRole(items[iid].kubun, sortProcs(byItem[iid] ?? [])) : null;
    return roles[iid];
  };
  const shippedOf = (pid: string) => ships.filter((s) => s.process_id === pid).reduce((t, s) => t + (Number(s.qty) || 0), 0);
  const liveW = (pid: string) => wAll.filter((w) => w.process_id === pid && !w.canceled_at);
  const errs: string[] = [];
  const skipped: string[] = [];
  const num = (v: unknown, h: string, name: string) => {
    const s = txt(v);
    if (s !== "" && !/^\d+(\.\d+)?$/.test(s)) errs.push(`${name}：${h}が数字ではありません（${s}）`);
    return s;
  };

  type Plan =
    | { kind: "work"; op: "wEnd" | "wEdit" | "wUndo"; w: WorkRow; f: { qty: string; ng: string; memo: string; s: string; e: string; mc: string; why: string } }
    | { kind: "proc"; op: string; r: ProcRow; set: Partial<ProcRow>; qty: string; wid?: string; f?: { qty: string; ng: string; memo: string; why: string; mc: string }; ship?: ShipInput | null }
    | { kind: "unship"; sid: string };
  const plan: Plan[] = [];
  // 出荷の欄をそろえる（出荷日が無ければ今日・担当者が無ければ作業者）
  const shipFields = (x: ShipInput | undefined): ShipInput => ({
    ship_date: txt(x?.ship_date) || when.slice(0, 10),
    dest: txt(x?.dest),
    contact: txt(x?.contact) || worker,
    packages: txt(x?.packages),
    carrier: txt(x?.carrier),
    slip_no: txt(x?.slip_no),
    time_spec: txt(x?.time_spec),
    note: txt(x?.note),
    from_stock: txt(x?.from_stock) === "1" ? "1" : "",
  });

  for (const a of acts) {
    if (a.op === "unship") {
      // 出荷の取り消し（工程の完了はそのまま）
      const sid = txt(a.sid);
      const f = sFound.find((x) => x.id === sid);
      if (!f) {
        errs.push("出荷の記録が見つかりません");
        continue;
      }
      if (f.canceled_at || !ships.some((x) => x.id === sid)) {
        skipped.push("この出荷は、もう取り消されていました");
        continue;
      }
      plan.push({ kind: "unship", sid });
      continue;
    }
    if (a.op === "wEnd" || a.op === "wEdit" || a.op === "wUndo") {
      const w = wAll.find((x) => x.id === txt(a.wid));
      if (!w) {
        errs.push("作業の記録が見つかりません");
        continue;
      }
      const nm = rows[w.process_id]?.name || "作業";
      if (w.canceled_at) {
        skipped.push(`${nm}：この作業は、もう取り消されていました`);
        continue;
      }
      if (a.op === "wEnd" && w.ended_at) {
        skipped.push(`${nm}：この作業は、ほかの人が先に終えていました（${w.ended_at}）`);
        continue;
      }
      if (a.op === "wEdit" && workMark(w) !== a.base) {
        errs.push(`${nm}：作業の記録が、画面を見ている間に変わりました。読み直してからもう一度直してください`);
        continue;
      }
      // ほかの人の作業を終える・直す・取り消すのは管理者だけ（他人の名前で記録を変えられないように）
      if (!admin && w.worker !== worker && w.account !== who) {
        errs.push(`${nm}：ほかの人（${w.worker}）の作業は、終える・直す・取り消すことができません（管理者に頼んでください）`);
        continue;
      }
      const f = {
        qty: num(a.qty, "完成数", nm),
        ng: num(a.ng, "不良数", nm),
        memo: txt(a.memo),
        s: txt(a.s),
        e: txt(a.e),
        mc: a.mc === undefined ? w.machine || "" : txt(a.mc),
        why: a.why === undefined ? w.defect_reason || "" : txt(a.why),
      };
      if (a.op === "wEdit") {
        if (!okAt(f.s) || (f.e && !okAt(f.e))) {
          errs.push(`${nm}：作業の日時の形がおかしいです（${f.s}／${f.e}）`);
          continue;
        }
        if (f.e && f.e < f.s) {
          errs.push(`${nm}：作業の終了が開始より前になっています`);
          continue;
        }
      }
      plan.push({ kind: "work", op: a.op, w, f });
      continue;
    }
    const r = rows[txt(a.pid)];
    if (!r) {
      errs.push("工程が見つかりません（CSVの取り込みで消えたかもしれません）");
      continue;
    }
    const name = r.name;
    const s = r.started_at || "";
    const e = r.done_at || "";
    const b = (typeof a.base === "object" && a.base) || {};
    const set: Partial<ProcRow> = {};
    const role = roleOf(r.item_id);
    const isShip = !!(role && role.ship === r.id);
    if (a.op === "wStart" || a.op === "wAdd") {
      if (e) {
        errs.push(`${name}：もう完了した工程です。作業を足すときは、先に「工程の完了を取り消す」を押してください`);
        continue;
      }
      const f =
        a.op === "wAdd"
          ? { qty: num(a.qty, "完成数", name), ng: num(a.ng, "不良数", name), memo: txt(a.memo), why: txt(a.why), mc: txt(a.mc) }
          : { qty: "", ng: "", memo: "", why: "", mc: txt(a.mc) };
      if (!s) {
        set.started_at = when;
        set.started_by = worker;
      }
      plan.push({ kind: "proc", r, set, op: a.op === "wAdd" ? "作業の記録" : "作業の開始", qty: f.qty, wid: newId("W"), f });
    } else if (a.op === "pMemo") {
      set.comment = txt(a.memo);
      plan.push({ kind: "proc", r, set, op: "コメント", qty: "" });
    } else if (a.op === "start") {
      if (e) {
        skipped.push(`${name}：もう完了していました`);
        continue;
      }
      if (s) {
        skipped.push(`${name}：ほかの人が先に開始していました（${s}）`);
        continue;
      }
      set.started_at = when;
      set.started_by = worker;
      plan.push({ kind: "proc", r, set, op: "開始", qty: "" });
    } else if (a.op === "done") {
      if (e) {
        skipped.push(`${name}：ほかの人が先に完了していました（${e}）`);
        continue;
      }
      const qty = txt(a.qty);
      if (!/^\d+(\.\d+)?$/.test(qty)) {
        errs.push(`${name}：${isShip ? "出荷の数" : "完成数量"}が数字ではありません（${qty}）`);
        continue;
      }
      let ship: ShipInput | null = null;
      if (isShip && Number(qty) > 0) {
        ship = shipFields(a.ship);
        if (!/^\d{4}\/\d{2}\/\d{2}$/.test(ship.ship_date!)) {
          errs.push(`${name}：出荷日の形がおかしいです（${ship.ship_date}）`);
          continue;
        }
      }
      if (!s) {
        set.started_at = when;
        set.started_by = worker;
      }
      set.done_at = when;
      set.done_by = worker;
      set.done_qty = isShip ? round(shippedOf(r.id) + Number(qty)) : qty;
      set.defect_qty = num(a.ng, "不良数", name);
      if (a.memo !== undefined) set.comment = txt(a.memo);
      if (a.why !== undefined) set.defect_reason = Number(set.defect_qty) > 0 ? txt(a.why) : "";
      plan.push({ kind: "proc", r, set, op: "完了", qty, ship });
    } else if (a.op === "ship") {
      // 分納：工程は作業中のまま、出荷だけ記録する（何回でも）
      if (e) {
        skipped.push(`${name}：ほかの人が先に完了していました（${e}）`);
        continue;
      }
      if (!isShip) {
        errs.push(`${name}：出荷の工程ではないので、出荷を記録できません`);
        continue;
      }
      const qty = txt(a.qty);
      if (!/^\d+(\.\d+)?$/.test(qty) || !(Number(qty) > 0)) {
        errs.push(`${name}：出荷の数は1以上の数字にしてください（${qty}）`);
        continue;
      }
      const ship = shipFields(a.ship);
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(ship.ship_date!)) {
        errs.push(`${name}：出荷日の形がおかしいです（${ship.ship_date}）`);
        continue;
      }
      if (!s) {
        set.started_at = when;
        set.started_by = worker;
      }
      plan.push({ kind: "proc", r, set, op: "出荷（分納）", qty, ship });
    } else if (a.op === "undoStart") {
      if (e || s !== (b.s || "")) {
        errs.push(`${name}：画面を見ている間にほかの人が変えたので、開始を取り消しませんでした`);
        continue;
      }
      if (isShip && ships.some((x) => x.process_id === r.id)) {
        errs.push(`${name}：出荷の記録があるので、開始を取り消せません（先に出荷を取り消してください）`);
        continue;
      }
      if (liveW(r.id).length) {
        errs.push(`${name}：作業の記録があるので、開始を取り消せません（先に作業を取り消してください）`);
        continue;
      }
      set.started_at = "";
      set.started_by = "";
      plan.push({ kind: "proc", r, set, op: "開始の取り消し", qty: "" });
    } else if (a.op === "undoDone") {
      if (!e || e !== (b.e || "") || s !== (b.s || "")) {
        errs.push(`${name}：画面を見ている間にほかの人が変えたので、完了を取り消しませんでした`);
        continue;
      }
      // 開始を押さずに完了していた（最後の「完了」の記録で開始が空だった）なら、開始も消して「まだ」に戻す
      const ld = lastDone[r.id];
      const alsoStart = !!ld && ld.action === "完了" && !ld.prev_started_at && s === e;
      if (alsoStart && !liveW(r.id).length) {
        set.started_at = "";
        set.started_by = "";
      }
      set.done_at = "";
      set.done_by = "";
      set.done_qty = "";
      set.defect_qty = "";
      set.defect_reason = "";
      plan.push({ kind: "proc", r, set, op: "完了の取り消し", qty: "" });
    } else errs.push(`知らない操作です（${String((a as { op: unknown }).op)}）`);
  }
  if (errs.length) throw new ActError(errs.join("\n"));

  // ── 書く行を組み立てる ──
  const putW: WorkRow[] = [];
  const putSH: Record<string, string>[] = [];
  const cancelSH: string[] = [];
  const putMV: Record<string, string>[] = [];
  const logs: Record<string, string>[] = [];
  const changed = new Set<string>();
  let n = 0;
  const tag = opId;
  const net = (col: "process_id" | "shipment_id", key: string) =>
    [...mvs, ...putMV].reduce((t, m) => (m[col] === key ? t + (Number(m.qty) || 0) : t), 0);
  const mv = (dw: string, q: number, kind: string, iid: string, pid: string, sid: string, what: string) => {
    putMV.push({
      id: `M${tag}-${++n}`, at: when, recorded_at: now, account: who, worker, drawing_no: dw, qty: round(q),
      kind, book: "画面", item_id: iid, process_id: pid, shipment_id: sid, detail: what, op_id: opId, source_key: "",
    });
  };
  const log = (iid: string, pid: string, action: string, qty: string, prevS: string, prevE: string, detail: string) =>
    logs.push({ at: when, recorded_at: now, account: who, worker, item_id: iid, process_id: pid, action, qty, prev_started_at: prevS, prev_done_at: prevE, op_id: opId, detail });
  const wNote = (x: WorkRow) =>
    [x.machine ? "機械 " + x.machine : "", Number(x.defect_qty) > 0 ? "不良 " + x.defect_qty + (x.defect_reason ? `（${x.defect_reason}）` : "") : "", x.comment]
      .filter(Boolean)
      .join(" ");
  const cancelShip = (sid: string) => {
    const sh = ships.find((x) => x.id === sid);
    if (!sh) return;
    cancelSH.push(sid);
    const q = net("shipment_id", sid);
    if (q) mv(items[sh.item_id]?.drawing_no || "", -q, "出荷の取り消し", sh.item_id, sh.process_id, sid, `${sh.ship_date} ${sh.qty}個`);
  };

  for (const pl of plan) {
    if (pl.kind === "unship") {
      const sh = ships.find((x) => x.id === pl.sid)!;
      cancelShip(pl.sid);
      log(sh.item_id, sh.process_id, "出荷の取り消し", sh.qty, "", "", `${sh.ship_date} ${sh.qty}個`);
      continue;
    }
    if (pl.kind === "work") {
      const x = pl.w;
      if (pl.op === "wUndo") {
        x.canceled_at = when;
        x.canceled_by = worker;
      } else {
        if (pl.op === "wEnd") x.ended_at = when;
        else {
          x.started_at = pl.f.s;
          x.ended_at = pl.f.e;
        }
        x.good_qty = pl.f.qty;
        x.defect_qty = pl.f.ng;
        x.comment = pl.f.memo;
        x.machine = pl.f.mc;
        x.defect_reason = Number(pl.f.ng) > 0 ? pl.f.why : "";
      }
      putW.push(x);
      log(x.item_id, x.process_id, { wEnd: "作業の終了", wEdit: "作業を直す", wUndo: "作業の取り消し" }[pl.op], x.good_qty, "", "", wNote(x));
      continue;
    }
    const r = pl.r;
    const prevS = r.started_at || "";
    const prevE = r.done_at || "";
    Object.assign(r, pl.set);
    if (Object.keys(pl.set).length) changed.add(r.id);
    const iid = r.item_id;
    const pid = r.id;
    const it = items[iid];
    const dw = it?.drawing_no || "";
    const no = it?.mgmt_no || "";
    const role = roleOf(iid);
    let what = "";
    if (pl.wid && pl.f) {
      const x: WorkRow = {
        id: pl.wid, item_id: iid, process_id: pid, worker, started_at: when, ended_at: "", good_qty: "", defect_qty: "",
        comment: "", source_key: "", recorded_at: now, account: who, canceled_at: "", canceled_by: "", op_id: opId, machine: pl.f.mc, defect_reason: "",
      };
      if (pl.op === "作業の記録") {
        x.ended_at = when;
        x.good_qty = pl.f.qty;
        x.defect_qty = pl.f.ng;
        x.comment = pl.f.memo;
        x.defect_reason = Number(pl.f.ng) > 0 ? pl.f.why : "";
      }
      wAll.push(x);
      putW.push(x);
      what = [pl.set.started_at ? "工程も開始" : "", wNote(x)].filter(Boolean).join(" ");
    }
    if (pl.op === "コメント") what = r.comment;
    if (pl.op === "完了")
      what = [r.defect_qty ? "不良 " + r.defect_qty + (r.defect_reason ? `（${r.defect_reason}）` : "") : "", pl.set.comment || ""].filter(Boolean).join(" ");
    if (role && pl.op === "完了" && role.prod === pid) {
      // 出荷の1つ手前が終わった：製品が増える（在庫から出した品目は増やさない）
      if (ships.some((x) => x.item_id === iid && x.from_stock === "1")) what = "在庫から出した品目なので、製品は増やさない";
      else if (Number(pl.qty) > 0) mv(dw, Number(pl.qty), "工程の完了", iid, pid, "", `${no} ${r.name}`);
    }
    if (role && pl.op === "完了の取り消し" && role.prod === pid) {
      const q = net("process_id", pid);
      if (q) mv(dw, -q, "完了の取り消し", iid, pid, "", `${no} ${r.name}`);
    }
    if (role && pl.op === "完了の取り消し" && role.ship === pid) {
      ships.filter((x) => x.process_id === pid).forEach((x) => {
        cancelShip(x.id);
        what = "出荷の記録も取り消した";
      });
    }
    if (pl.ship) {
      // 出荷を記録：製品が減る。在庫から出したときは、この品目の完了で増やした分も戻す
      const sid = `S${tag}-${putSH.length + 1}`;
      putSH.push({
        id: sid, item_id: iid, process_id: pid, qty: pl.qty, recorded_at: now, account: who, worker, op_id: opId,
        ...(Object.fromEntries(Object.entries(pl.ship).map(([k, v]) => [k, v ?? ""])) as Record<string, string>),
      });
      mv(dw, -Number(pl.qty), "出荷", iid, pid, sid, `${no} ${pl.ship.ship_date}${pl.ship.carrier ? " " + pl.ship.carrier : ""}${pl.ship.slip_no ? " " + pl.ship.slip_no : ""}`);
      if (pl.ship.from_stock === "1" && role && role.prod) {
        const q = net("process_id", role.prod);
        if (q > 0) mv(dw, -q, "在庫から出した（完了で増やした分を戻す）", iid, role.prod, sid, no);
      }
      what = `出荷 ${pl.ship.ship_date} ${pl.qty}個${pl.ship.from_stock === "1" ? "（在庫から）" : ""}`;
    }
    log(iid, pid, pl.op, pl.qty, prevS, prevE, what);
  }

  // 作業に完成数・不良数が入っていたら、その合計を工程の完成数量・不良数（と多い不良の理由）に入れる。出荷の工程は変えない
  // 作業の数がみんな無くなった（取り消した・直した）ときは、まだ完了していない工程の数を空に戻す
  const wPids = new Set<string>();
  plan.forEach((pl) => {
    if (pl.kind === "work") wPids.add(pl.w.process_id);
    else if (pl.kind === "proc" && pl.op === "作業の記録") wPids.add(pl.r.id);
  });
  const withNum = (pid: string) => wAll.filter((w) => w.process_id === pid && !w.canceled_at && (w.good_qty !== "" || w.defect_qty !== ""));
  const total = (l: WorkRow[], h: "good_qty" | "defect_qty") => round(l.reduce((t, w) => t + (Number(w[h]) || 0), 0));
  wPids.forEach((pid) => {
    const r = rows[pid];
    if (!r) return;
    const role = roleOf(r.item_id);
    if (role && role.ship === pid) return;
    const l = withNum(pid);
    const set: Partial<ProcRow> = {};
    if (l.length) {
      if (l.some((w) => w.good_qty !== "")) set.done_qty = total(l, "good_qty");
      if (l.some((w) => w.defect_qty !== "")) {
        const t = total(l, "defect_qty");
        set.defect_qty = t === "0" ? "" : t;
        const cnt: Record<string, number> = {};
        l.forEach((w) => {
          if (w.defect_reason && Number(w.defect_qty) > 0) cnt[w.defect_reason] = (cnt[w.defect_reason] || 0) + Number(w.defect_qty);
        });
        set.defect_reason = Number(set.defect_qty) > 0 ? Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0] || "" : "";
      }
    } else if (!r.done_at) {
      set.done_qty = "";
      set.defect_qty = "";
      set.defect_reason = "";
    }
    (Object.keys(set) as (keyof ProcRow)[]).forEach((k) => {
      if (r[k] !== set[k]) {
        r[k] = set[k] as string;
        changed.add(pid);
      }
    });
  });

  // ── まとめて1回で書く ──
  const stmts: D1PreparedStatement[] = [];
  const setSql = PROC_SET_COLS.map((c) => `${c} = ?`).join(", ");
  changed.forEach((pid) => {
    const r = rows[pid];
    stmts.push(db.prepare(`UPDATE processes SET ${setSql} WHERE id = ?`).bind(...PROC_SET_COLS.map((c) => r[c] ?? ""), pid));
  });
  const WCOLS = Object.keys(putW[0] ?? {}) as (keyof WorkRow)[];
  putW.forEach((w) =>
    stmts.push(db.prepare(`INSERT OR REPLACE INTO works (${WCOLS.join(", ")}) VALUES (${WCOLS.map(() => "?").join(", ")})`).bind(...WCOLS.map((c) => w[c] ?? "")))
  );
  putSH.forEach((s) => {
    const cols = Object.keys(s);
    stmts.push(db.prepare(`INSERT INTO shipments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => s[c])));
  });
  cancelSH.forEach((sid) => stmts.push(db.prepare("UPDATE shipments SET canceled_at = ?, canceled_by = ? WHERE id = ?").bind(when, worker, sid)));
  putMV.forEach((m) => {
    const cols = Object.keys(m);
    stmts.push(db.prepare(`INSERT INTO stock_moves (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => m[c])));
  });
  if (logs.length) {
    const cols = Object.keys(logs[0]);
    stmts.push(
      db
        .prepare(`INSERT INTO action_log (${cols.join(", ")}) SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?)`)
        .bind(JSON.stringify(logs))
    );
  }
  if (stmts.length) {
    stmts.push(db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'ver'"));
    await db.batch(stmts);
  }
  return { skipped, changed: changed.size };
}
