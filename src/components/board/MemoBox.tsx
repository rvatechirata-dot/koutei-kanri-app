"use client";

/**
 * 案件メモ欄（2026-11-24・川﨑部長の画面案 案3）。エムネットの各案件の「チャット」に近いもの。
 * 会話ではなく、現品票・製作の必要事項・注意事項を書いておく場所。2段に分ける。
 *   上：⚠ この品番の注意（図面番号ごと・同じ図番の次の案件にも出る）。黄色で目立たせる。直すたびに前の版を残す。
 *   下：この案件のメモ（今回だけ）。書くたびに1件増える（新しい順）。種類＝必要事項・注意・現品票・連絡。
 * 工程一覧で品目を開いたところ（full）と、工程の大きい画面（compact＝メモの一覧は畳む）で使う。
 * 写真・PDF はまだ付けられない（ファイルの置き場所 R2 がアプリに無い。平田さんに足してもらってから）。
 */
import { useState } from "react";
import type { BoardItem, DrawingNote, ItemMemo } from "@/lib/kotei/board";

export type MemoMe = { name: string; named: boolean; admin: boolean; email?: string };

const KINDS = ["必要事項", "注意", "現品票", "連絡"] as const;
const KIND_STYLE: Record<string, string> = {
  注意: "border-[#B08A00] bg-warn-bg",
  必要事項: "border-accent text-accent bg-white",
  現品票: "border-ok text-ok bg-white",
  連絡: "border-line bg-card",
};
const BTN = "min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50";
const MAIN = `${BTN} bg-accent text-white`;
const SUB = `${BTN} border border-accent bg-white text-accent`;
const newOpId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

type Hist = { id: string; body: string; saved_at: string; saved_name: string };

export default function MemoBox({ it, me, worker, compact, onSaved }: { it: BoardItem; me: MemoMe; worker: string; compact?: boolean; onSaved?: () => void }) {
  // 書いたらすぐ見えるよう、手元にも持つ（画面の読み直しが届いたらそちらに合わせる）
  const [memos, setMemos] = useState<ItemMemo[]>(it.memos);
  const [dnote, setDnote] = useState<DrawingNote | null>(it.dnote);
  const [src, setSrc] = useState({ memos: it.memos, dnote: it.dnote });
  if (src.memos !== it.memos || src.dnote !== it.dnote) {
    setSrc({ memos: it.memos, dnote: it.dnote });
    setMemos(it.memos);
    setDnote(it.dnote);
  }

  const [edit, setEdit] = useState<string | null>(null);
  const [hist, setHist] = useState<Hist[] | null>(null);
  const [kind, setKind] = useState<string>("必要事項");
  const [body, setBody] = useState("");
  const [toD, setToD] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const dwg = it.drawing_no.trim();
  const noteText = dnote?.body ?? "";
  const needName = !me.named && !worker;

  const post = async (payload: Record<string, unknown>) => {
    if (needName) {
      setMsg({ text: "画面の上で作業者を選んでから書いてください。", bad: true });
      return null;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, opId: newOpId(), name: me.named ? undefined : worker }),
      });
      const j = (await r.json()) as { error?: string; memo?: ItemMemo; dnote?: DrawingNote | null };
      if (!r.ok) {
        setMsg({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）", bad: true });
        return null;
      }
      onSaved?.();
      return j;
    } catch {
      setMsg({ text: "通信できませんでした。保存されたか分からないので、画面を最新にして確かめてください。", bad: true });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const t = body.trim();
    if (!t) return;
    const j = await post({ op: "add", item_id: it.id, kind, body: t, toDrawing: toD && !!dwg });
    if (!j) return;
    if (j.memo) setMemos([j.memo, ...memos]);
    if (j.dnote) setDnote(j.dnote);
    setBody("");
    setToD(false);
    setMsg({ text: toD && dwg ? "書きました（品番の注意にも足しました）" : "書きました" });
  };
  const cancel = async (m: ItemMemo) => {
    if (!confirm(`このメモを消します（記録には残ります）。\n「${m.body.slice(0, 40)}」\nよろしいですか？`)) return;
    const j = await post({ op: "cancel", id: m.id });
    if (j) setMemos(memos.filter((x) => x.id !== m.id));
  };
  const saveNote = async () => {
    if (edit === null) return;
    const j = await post({ op: "drawing", drawing_no: dwg, body: edit, base: dnote?.id ?? "" });
    if (!j) return;
    if (j.dnote) setDnote(j.dnote);
    setEdit(null);
    setHist(null);
    setMsg({ text: "品番の注意を直しました" });
  };
  const showHist = async () => {
    if (hist) return setHist(null);
    const r = await fetch(`/api/memos?drawing=${encodeURIComponent(dwg)}`, { cache: "no-store" });
    if (r.ok) setHist(((await r.json()) as { history: Hist[] }).history);
  };

  const mine = (m: ItemMemo) => me.admin || (!!me.email && m.created_by === me.email);

  const memoList = (
    <div className="flex flex-col gap-2">
      {memos.length === 0 && <p className="text-base text-ink-sub">まだメモはありません。</p>}
      {memos.map((m) => (
        <div key={m.id} className="rounded-lg border border-line bg-white p-2">
          <div className="flex items-start gap-2">
            <span className={`shrink-0 rounded border px-1 text-sm font-bold ${KIND_STYLE[m.kind] ?? KIND_STYLE["連絡"]}`}>{m.kind === "注意" ? "⚠ 注意" : m.kind}</span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-base">{m.body}</p>
            {mine(m) && (
              <button type="button" disabled={busy} onClick={() => cancel(m)} className="shrink-0 rounded border border-line px-2 text-sm text-ink-sub disabled:opacity-50">
                消す
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-sub">
            {m.created_name} {m.created_at}
          </p>
        </div>
      ))}
      <div className="rounded-lg bg-card p-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="メモの種類">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`min-h-11 rounded-lg border px-3 text-base ${kind === k ? "border-accent bg-accent font-bold text-white" : "border-line bg-white"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={kind === "現品票" ? "現品票の中身（番号・数・ロットなど）を書く。写真はまだ付けられません" : "ここに書く（例：今回は材料支給。11/28 着）"}
          className="mt-2 w-full rounded border border-ink-sub bg-white p-2 text-base"
        />
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <button type="button" disabled={busy || !body.trim()} onClick={add} className={MAIN}>
            書く
          </button>
          {dwg && (
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input type="checkbox" checked={toD} onChange={(e) => setToD(e.target.checked)} className="h-5 w-5" />
              品番の注意にも足す（同じ図番の次の案件にも出す）
            </label>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <section className="flex flex-col gap-2">
      {/* 品番の注意 */}
      {edit !== null ? (
        <div className="rounded-lg border-2 border-[#B08A00] bg-warn-bg p-2">
          <p className="text-base font-bold">⚠ この品番の注意を直す（図番 {dwg}・同じ図番の案件すべてに出る）</p>
          <textarea value={edit} onChange={(e) => setEdit(e.target.value)} rows={5} maxLength={5000} className="mt-2 w-full rounded border border-ink-sub bg-white p-2 text-base" placeholder="例：内径 φ40H7 は最後に仕上げ。&#10;真円度 0.005 を全数。成績書あり。" />
          <p className="text-sm text-ink-sub">1行に1つずつ書くと読みやすくなります。全部消して保存すると「注意なし」に戻ります（前の版は残ります）。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={saveNote} className={MAIN}>
              保存
            </button>
            <button type="button" disabled={busy} onClick={() => setEdit(null)} className={SUB}>
              やめる
            </button>
          </div>
        </div>
      ) : noteText ? (
        <div className="rounded-lg border-2 border-[#B08A00] bg-warn-bg p-2">
          <div className="flex flex-wrap items-start gap-2">
            <p className="text-base font-bold">⚠ この品番の注意</p>
            <span className="text-sm text-ink-sub">図番 {dwg}・同じ図番の案件すべてに出る</span>
            <span className="ml-auto flex gap-2">
              <button type="button" onClick={() => setEdit(noteText)} className="min-h-11 rounded-lg border border-accent bg-white px-3 text-base font-bold text-accent">
                直す
              </button>
              <button type="button" onClick={showHist} className="min-h-11 rounded-lg border border-line bg-white px-3 text-base">
                {hist ? "前の版を閉じる" : "前の版"}
              </button>
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-lg font-bold">{noteText}</p>
          <p className="mt-1 text-sm text-ink-sub">
            最後に直した人：{dnote?.saved_name} {dnote?.saved_at}
          </p>
        </div>
      ) : compact ? null : dwg ? (
        <div className="flex flex-wrap items-center gap-2 text-base text-ink-sub">
          この品番（図番 {dwg}）の注意はまだありません。
          <button type="button" onClick={() => setEdit("")} className="min-h-11 rounded-lg border border-accent bg-white px-3 font-bold text-accent">
            ⚠ 品番の注意を書く
          </button>
          {dnote && (
            <button type="button" onClick={showHist} className="min-h-11 rounded-lg border border-line bg-white px-3">
              {hist ? "前の版を閉じる" : "前の版"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-sub">図面番号が無いので、品番の注意は書けません（この案件のメモは書けます）。</p>
      )}
      {hist && (
        <div className="rounded-lg border border-line bg-white p-2">
          <p className="text-base font-bold">品番の注意の版（新しい順）</p>
          {hist.map((h, k) => (
            <div key={h.id} className="mt-2 border-t border-line pt-2">
              <p className="text-sm text-ink-sub">
                {k === 0 ? "今の版　" : ""}
                {h.saved_name} {h.saved_at}
              </p>
              <p className="whitespace-pre-wrap break-words text-base">{h.body || "（注意なしに戻した）"}</p>
            </div>
          ))}
        </div>
      )}

      {/* この案件のメモ */}
      {compact ? (
        <details className="rounded-lg border border-line p-2" open={memos.length > 0 && memos.some((m) => m.kind === "注意")}>
          <summary className="min-h-11 cursor-pointer content-center text-base font-bold">
            💬 この案件のメモ（今回だけ） {memos.length}件
          </summary>
          <div className="mt-2">{memoList}</div>
        </details>
      ) : (
        <div>
          <h3 className="text-base font-bold">💬 この案件のメモ（今回だけ） {memos.length}件</h3>
          <div className="mt-2">{memoList}</div>
        </div>
      )}
      {msg && (
        <p role="status" className={`rounded border p-2 text-base ${msg.bad ? "border-danger text-danger" : "border-ok"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

/** 一覧の行・ボードのカードに付ける小さい印（⚠＝品番の注意あり・💬＝この案件のメモの件数） */
export function MemoMarks({ it }: { it: BoardItem }) {
  const warn = !!it.dnote?.body;
  const n = it.memos.length;
  if (!warn && !n) return null;
  return (
    <span className="inline-flex shrink-0 gap-1">
      {warn && (
        <span className="rounded border border-[#B08A00] bg-warn-bg px-1 text-sm font-bold" title={`品番の注意：${it.dnote?.body ?? ""}`}>
          ⚠ 注意
        </span>
      )}
      {n > 0 && (
        <span className="rounded border border-line bg-white px-1 text-sm" title={`この案件のメモ ${n}件`}>
          💬{n}
        </span>
      )}
    </span>
  );
}
