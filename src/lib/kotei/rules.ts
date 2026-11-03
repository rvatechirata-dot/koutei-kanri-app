/**
 * 工程・在庫・名寄せのきまり（画面とサーバーの両方で使う。データベースには触らない）。
 * 川﨑課長の試作（index.html／コード.gs の同じ名前の関数）と同じ中身にしてある。
 */
import type { MasterRow, ProcRow } from "./types";

/** 物が動かない工程（在庫の計算から外す。名前の完全一致） */
export const NOQTY = ["材料発注", "材料入荷", "材料", "帳票発行", "ダミー工程", "完品在庫数", "材料在庫数", "在庫"];
/** エムネットで在庫を数えるために作った品目の区分。この品目の工程からは在庫の動きを作らない */
export const STOCK_CAT = "在庫管理";
/** これより前の納期で、完了した工程がない新しい品目は「古い案件」として最初は取り込まない（試作のコードの値。手順書は「2024年より前」と書いている） */
export const OLD_DUE = "2025/01/01";

/** 出荷の工程の名前か（「出荷」「分納出荷」など。「出荷目視」「出荷検査」は出荷の前の検査なので除く） */
export function isShipName(n: string): boolean {
  return /出荷/.test(n) && !/目視|検査/.test(n);
}

export function sortProcs<T extends Pick<ProcRow, "seq">>(ps: T[]): T[] {
  return ps.slice().sort((x, y) => Number(x.seq) - Number(y.seq));
}

/**
 * 品目の工程の並びから、在庫で使う工程を決める（procs は順番どおり）。
 *   ship：出荷の工程（「出荷」が無ければ最後の工程）。prod：製品になる工程（出荷の1つ手前。無ければ空＝在庫から出すだけ）
 *   q：数に関係する工程（物が動かない工程を除いて、出荷まで）
 */
export function stockRole(kubun: string, procs: Pick<ProcRow, "id" | "name">[]): { ship: string; prod: string; q: string[] } | null {
  if (kubun === STOCK_CAT) return null;
  const q = procs.filter((p) => NOQTY.indexOf(String(p.name || "").trim()) < 0);
  if (!q.length) return null;
  let k = q.findIndex((p) => isShipName(p.name));
  if (k < 0) k = q.length - 1;
  return { ship: q[k].id, prod: k > 0 ? q[k - 1].id : "", q: q.slice(0, k + 1).map((p) => p.id) };
}

/** 工程の状態は日時から決める（列は持たない） */
export type ProcState = "done" | "doing" | "todo";
export function procState(p: Pick<ProcRow, "started_at" | "done_at">): ProcState {
  if (p.done_at) return "done";
  if (p.started_at) return "doing";
  return "todo";
}

/** 今の工程＝順番どおりで、最初に完了日時が無い工程（後ろが先に終わっていても、前の未完了が今の工程） */
export function currentProc<T extends Pick<ProcRow, "seq" | "done_at">>(procs: T[]): T | null {
  return sortProcs(procs).find((p) => !p.done_at) ?? null;
}

/* ===== 名寄せ（基本の一覧） ===== */
export const MASTER_KINDS = ["工程名", "作業者", "機械", "外注先", "顧客", "不良の理由"] as const;
/** 「担当なし」の印。名寄せしない */
export const NO_NAME = ["-", "ー", "－", "―"];

export function aliasList(s: string): string[] {
  const out: string[] = [];
  String(s || "")
    .split(/[｜\n]/)
    .forEach((v) => {
      v = v.trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    });
  return out;
}

export type MasterMap = Record<string, Record<string, string>>;

/** 種類ごとに「書き方 → そろえた名前」。一覧の名前そのものも入れる */
export function masterMap(rows: Pick<MasterRow, "kind" | "name" | "aliases">[]): MasterMap {
  const o: MasterMap = {};
  MASTER_KINDS.forEach((k) => {
    o[k] = {};
  });
  rows.forEach((r) => {
    if (!o[r.kind] || !r.name) return;
    aliasList(r.aliases).forEach((a) => {
      o[r.kind][a] = r.name;
    });
    o[r.kind][r.name] = r.name;
  });
  return o;
}

/** 1つの値を、表に合わせてそろえる（表に無い書き方はそのまま） */
export function normOne(map: MasterMap, kind: string, v: string): string {
  const s = String(v ?? "").trim();
  if (!s || NO_NAME.indexOf(s) >= 0) return String(v ?? "");
  const n = map[kind]?.[s];
  return n === undefined ? String(v) : n;
}
