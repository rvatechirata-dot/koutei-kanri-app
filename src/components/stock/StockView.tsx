"use client";

/**
 * 在庫の画面（3段目）。図面番号ごとに「エムネットの写し」「この画面の計算」「差」「仕掛品」「出荷待ち」。★の列が正しい数。
 * 行を押すと、仕掛品の内訳・増えた／減ったの履歴・数を直す（管理者だけ）が出る。数え方は試作と同じ（src/lib/kotei/stock.ts）。
 * エムネットの完品在庫数を写すのは「CSV取り込み」の画面（作業ログCSV）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StockData, StockDetail, StockRow } from "@/lib/kotei/stock";
import ScrollWrap from "@/components/ScrollWrap";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const sign = (n: number) => (n > 0 ? "+" : "") + fmt(n);

export default function StockView({ admin }: { admin: boolean }) {
  const [data, setData] = useState<StockData | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stock", { cache: "no-store" });
      setData((await r.json()) as StockData);
    } catch {
      setErr("読み込めませんでした。通信を確かめて、画面を開き直してください。");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const k = q.trim().toLowerCase();
    return data.rows.filter((x) => (!only || x.nM || x.nS || x.wipN) && (!k || `${x.dw} ${x.name}`.toLowerCase().includes(k)));
  }, [data, q, only]);

  if (!data) return <p className="py-8 text-base text-ink-sub">{err || "読み込み中…"}</p>;
  const main = data.main;

  const post = async (body: Record<string, string>, done: string) => {
    const r = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { error?: string };
    setMsg(r.ok ? { text: done } : { text: j.error || `保存できませんでした（${r.status}）`, bad: true });
    if (r.ok) await load();
    return r.ok;
  };
  const switchMain = () => {
    const to = main === "画面" ? "エムネット" : "画面";
    const text =
      to === "画面"
        ? "製品の数の「正」を「この画面の計算」に変えます。\nエムネットからの入力をやめて、こちらに切り替えるときに使います。\n先に、差のある図面番号は「エムネットの数に合わせる」で合わせておいてください。よろしいですか？"
        : "製品の数の「正」を「エムネットの写し」に戻します。よろしいですか？";
    if (confirm(text)) post({ kind: "main", main: to }, "切り替えました");
  };

  const th = (n: string, k: StockData["main"]) => (
    <th key={k} className={`whitespace-nowrap border-b border-line px-2 py-1 text-right font-bold ${main === k ? "text-accent" : ""}`}>
      {n}
      {main === k ? " ★" : ""}
    </th>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold">在庫</h1>
      {msg && (
        <p role="status" className={`mt-2 rounded border bg-white p-2 text-base ${msg.bad ? "border-danger text-danger" : "border-ok"}`}>
          {msg.text}
        </p>
      )}
      <section className="mt-4 rounded-lg bg-card p-4 text-base">
        <p>
          製品の数の「正」：<b>{main === "画面" ? "この画面の計算" : "エムネットの写し（完品在庫数）"}</b>（★の列）
          {admin && (
            <button type="button" onClick={switchMain} className="ml-4 min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
              {main === "画面" ? "エムネットの写しを正に戻す" : "この画面の計算を正にする（切り替えのとき）"}
            </button>
          )}
        </p>
        <ul className="mt-2 list-disc pl-8 text-sm text-ink-sub">
          <li>エムネットの写し：エムネットの作業ログCSVの「完品在庫数」の＋/−を足したもの。{admin ? <Link href="/import" className="text-accent underline">CSV取り込み</Link> : "CSV取り込み"}の画面で読み込みます。</li>
          <li>この画面の計算：最初の数 ＋ 出荷の1つ手前の工程が終わった数 − 出荷した数 ＋ 数を直した分。</li>
          <li>仕掛品：まだ製品になっていない品目の、最後に終わった工程ごとの数（材料発注・帳票発行など物が動かない工程は数えない）。</li>
          <li>出荷待ち：出荷の工程がまだの品目の「数量 − 出荷した数」（まだ始まっていない品目も入ります）。</li>
        </ul>
      </section>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          さがす（図面番号・品名）
          <input value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 w-72 max-w-full rounded border border-ink-sub bg-white px-2 text-base" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="h-5 w-5" />
          在庫か仕掛品のある図面番号だけ
        </label>
      </div>
      <p className="mt-2 text-base">{rows.length}件。行を押すと、仕掛品の内訳・履歴{admin ? "・数を直す" : ""}が出ます。</p>

      <ScrollWrap className="mt-2">
        <table className="w-full text-base">
          <thead className="bg-card">
            <tr>
              <th className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">図面番号</th>
              <th className="border-b border-line px-2 py-1 text-left font-bold">品名</th>
              {th("エムネットの写し", "エムネット")}
              {th("この画面の計算", "画面")}
              <th className="border-b border-line px-2 py-1 text-right font-bold">差</th>
              <th className="border-b border-line px-2 py-1 text-left font-bold">仕掛品</th>
              <th className="whitespace-nowrap border-b border-line px-2 py-1 text-right font-bold">出荷待ち</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-2 text-ink-sub">
                  {q ? "条件に合う図面番号がありません。" : "まだ在庫の記録がありません。"}
                </td>
              </tr>
            )}
            {rows.map((x) => (
              <StockLine key={x.dw} x={x} main={main} open={open === x.dw} onToggle={() => setOpen(open === x.dw ? null : x.dw)} admin={admin} post={post} />
            ))}
          </tbody>
        </table>
      </ScrollWrap>
    </div>
  );
}

function StockLine({
  x,
  main,
  open,
  onToggle,
  admin,
  post,
}: {
  x: StockRow;
  main: StockData["main"];
  open: boolean;
  onToggle: () => void;
  admin: boolean;
  post: (b: Record<string, string>, done: string) => Promise<boolean>;
}) {
  const diff = x.scr - x.mnet;
  const both = x.nM > 0 && x.nS > 0;
  const cell = (v: string, k: StockData["main"]) => <td className={`whitespace-nowrap px-2 py-1 text-right ${main === k ? "font-bold" : ""}`}>{v}</td>;
  return (
    <>
      <tr className={`cursor-pointer border-b border-line ${open ? "outline-2 outline-accent" : ""}`} onClick={onToggle}>
        <td className="whitespace-nowrap px-2 py-1">
          <button type="button" className="min-h-11 text-left font-bold text-accent underline" aria-expanded={open}>
            {x.dw}
          </button>
        </td>
        <td className="px-2 py-1">{x.name}</td>
        {cell(x.nM ? fmt(x.mnet) : "―", "エムネット")}
        {cell(x.nS ? fmt(x.scr) : "―", "画面")}
        <td className={`whitespace-nowrap px-2 py-1 text-right ${both && diff ? "font-bold text-danger" : ""}`}>{both ? (diff ? `${sign(diff)}（差あり）` : "0") : ""}</td>
        <td className="px-2 py-1">
          {Object.entries(x.wip)
            .map(([k, n]) => `${k} ${fmt(n)}`)
            .join("・")}
        </td>
        <td className="px-2 py-1 text-right">{x.wait ? fmt(x.wait) : ""}</td>
      </tr>
      {open && (
        <tr className="no-stripe">
          <td colSpan={7} className="bg-white px-2 py-4">
            <Detail x={x} admin={admin} post={post} />
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ x, admin, post }: { x: StockRow; admin: boolean; post: (b: Record<string, string>, done: string) => Promise<boolean> }) {
  const [d, setD] = useState<StockDetail | null>(null);
  const [n, setN] = useState("");
  const [reason, setReason] = useState("");
  const reload = useCallback(() => {
    fetch(`/api/stock?dw=${encodeURIComponent(x.dw)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setD(j as StockDetail))
      .catch(() => {});
  }, [x.dw]);
  useEffect(() => {
    reload();
  }, [reload, x.scr, x.mnet]);
  const toMnet = x.mnet - x.scr;

  return (
    <div className="max-w-5xl">
      {admin && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-2 text-sm">
            この画面の数を直す（増やす数。減らすときは −）
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="例：-2" inputMode="decimal" className="min-h-11 w-32 rounded border border-ink-sub bg-white px-2 text-right text-base" />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            理由（必ず）
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="棚卸しの差・数え間違い など" className="min-h-11 w-72 rounded border border-ink-sub bg-white px-2 text-base" />
          </label>
          <button
            type="button"
            onClick={async () => {
              const v = n.trim().replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
              if (!/^-?\d+(\.\d+)?$/.test(v) || !Number(v)) return alert("増やす数（減らすときは −）を数字で入れてください");
              if (!reason.trim()) return alert("理由を書いてください");
              if (!confirm(`${x.dw} の「この画面の数」を ${fmt(x.scr)} → ${fmt(x.scr + Number(v))} にします。\n理由：${reason}\nよろしいですか？`)) return;
              if (await post({ kind: "adjust", dw: x.dw, n: v, reason }, "直しました")) {
                setN("");
                setReason("");
              }
            }}
            className="min-h-11 rounded-lg bg-accent px-4 text-base font-bold text-white"
          >
            数を直す
          </button>
          {x.nM > 0 && toMnet !== 0 && (
            <button
              type="button"
              onClick={() => {
                const why = reason.trim() || "エムネットの完品在庫数に合わせた";
                if (confirm(`${x.dw} の「この画面の数」を ${fmt(x.scr)} → ${fmt(x.mnet)}（${sign(toMnet)}）にします。\n理由：${why}\nよろしいですか？`))
                  post({ kind: "adjust", dw: x.dw, n: fmt(toMnet), reason: why }, "エムネットの数に合わせました");
              }}
              className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent"
            >
              この画面の数をエムネットの数に合わせる（{sign(toMnet)}）
            </button>
          )}
        </div>
      )}
      {!d && <p className="mt-4 text-base text-ink-sub">読み込み中…</p>}
      {d && d.wipItems.length > 0 && (
        <>
          <h3 className="mt-4 text-base font-bold">仕掛品の内訳</h3>
          <table className="mt-2 text-base">
            <thead className="bg-card">
              <tr>
                {["社内管理番号", "どの工程まで", "数", "最終納期"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-1 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.wipItems.map((w, k) => (
                <tr key={k} className="border-b border-line">
                  <td className="px-2 py-1">{w.mgmt_no}</td>
                  <td className="px-2 py-1">{w.stage}</td>
                  <td className="px-2 py-1 text-right">{fmt(w.n)}</td>
                  <td className="px-2 py-1">{w.final_due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {d && (
        <>
          <h3 className="mt-4 text-base font-bold">増えた・減ったの履歴（新しい順・300件まで）</h3>
          <table className="mt-2 w-full text-base">
            <thead className="bg-card">
              <tr>
                {["日時", "帳簿", "種類", "数", "どこから", "内容", "記録した人"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.moves.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-2 text-ink-sub">
                    まだありません。
                  </td>
                </tr>
              )}
              {d.moves.map((m, k) => (
                <tr key={k} className="border-b border-line">
                  <td className="whitespace-nowrap px-2 py-1">{m.at}</td>
                  <td className="whitespace-nowrap px-2 py-1">{m.book === "エムネット" ? "エムネット" : "この画面"}</td>
                  <td className="whitespace-nowrap px-2 py-1">{m.kind}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{sign(Number(m.qty) || 0)}</td>
                  <td className="px-2 py-1">{m.where}</td>
                  <td className="px-2 py-1">{m.detail}</td>
                  <td className="whitespace-nowrap px-2 py-1">{m.worker}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
