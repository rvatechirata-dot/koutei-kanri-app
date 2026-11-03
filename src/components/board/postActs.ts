/**
 * 工程・作業・出荷の操作をサーバーに送る（工程一覧・出荷の画面で共通）。
 * 操作の札を付けるので、同じ操作が2回届いても1回分になる。
 */
import type { Act } from "@/lib/kotei/acts";

const newOpId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** pick＝共有メールのときに画面で選んだ作業者（ログインした人で決まるときは undefined） */
export async function postActs(acts: Act[], pick: string | undefined, doneMsg: string): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetch("/api/acts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acts, worker: pick, opId: newOpId() }),
    });
    const j = (await r.json()) as { error?: string; skipped?: string[] };
    if (!r.ok) return { ok: false, text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）" };
    return { ok: true, text: [doneMsg, ...(j.skipped ?? [])].join("\n") };
  } catch {
    return { ok: false, text: "通信できませんでした。保存されたか分からないので、「最新にする」で確かめてください。" };
  }
}

/** 共有メールのときに端末で選んだ作業者（端末ごとに覚える） */
export function loadPick(): string {
  try {
    return typeof window === "undefined" ? "" : localStorage.getItem("koutei:worker") || "";
  } catch {
    return "";
  }
}
