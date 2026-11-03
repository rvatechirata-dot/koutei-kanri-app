/**
 * 画面から送られてきたCSVの行（CsvRec）を確かめる。
 * 決まった項目だけを文字として取り出し、知らない項目は捨てる（変な中身をそのまま表に書かないため）。
 */
import type { CaseFields, CsvRec, ItemFields, ProcFields } from "./types";
import { CASE_LABEL, ITEM_LABEL } from "./types";

const PROC_KEYS: (keyof ProcFields)[] = [
  "seq", "in_out", "mnet_slot", "name", "assignee", "machine", "plan_start", "due", "started_at", "done_at",
  "done_qty", "inspected_on", "inspector", "unit_price", "std_time", "note", "extra_json",
];
const MAX_RECS = 20000;
const MAX_LEN = 20000; // 1つの欄の文字数の上限（備考・ノウハウが長くても入るように大きめ）

function pick<K extends string>(o: unknown, keys: K[]): Record<K, string> | null {
  if (!o || typeof o !== "object") return null;
  const src = o as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = src[k] ?? "";
    if (typeof v !== "string" || v.length > MAX_LEN) return null;
    out[k] = v;
  }
  return out;
}

export function checkRecs(v: unknown): CsvRec[] | null {
  if (!Array.isArray(v) || v.length > MAX_RECS) return null;
  const out: CsvRec[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") return null;
    const x = r as Record<string, unknown>;
    const a = pick(x.a, Object.keys(CASE_LABEL) as (keyof CaseFields)[]);
    const i = pick(x.i, Object.keys(ITEM_LABEL) as (keyof ItemFields)[]);
    if (!a || !i || !i.barcode || !Array.isArray(x.p) || x.p.length > 400) return null;
    const p: ProcFields[] = [];
    for (const pr of x.p) {
      const q = pick(pr, PROC_KEYS);
      if (!q || !q.mnet_slot) return null;
      p.push(q);
    }
    out.push({ line: Number(x.line) || 0, a, i, p });
  }
  return out;
}
