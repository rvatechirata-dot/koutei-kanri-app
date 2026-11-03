import type { LogLine } from "@/lib/kotei/worklog";

const KEYS: (keyof LogLine)[] = ["bc", "proc", "st", "en", "worker", "qty", "mc", "dw", "name", "mgmt", "note"];

/** 画面から送られてきた作業ログの行を、決まった項目だけの文字にする */
export function checkLines(v: unknown): LogLine[] | null {
  if (!Array.isArray(v) || v.length > 50000) return null;
  const out: LogLine[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    const r = { line: Number(o.line) || 0 } as LogLine;
    for (const k of KEYS) {
      const s = o[k] ?? "";
      if (typeof s !== "string" || s.length > 5000) return null;
      (r as unknown as Record<string, string>)[k] = s;
    }
    out.push(r);
  }
  return out;
}
