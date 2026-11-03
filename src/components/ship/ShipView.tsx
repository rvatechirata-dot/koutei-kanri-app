"use client";

/**
 * 出荷の画面（3段目）。上＝出荷予定（今日まで・今週・来週まで・まだ出荷していない全部）、下＝出荷の記録（新しい順・取り消せる）。
 * 予定日は「出荷の工程の納期 → 開始予定 → 品目の最終納期」の順に、入っているもの（試作と同じ）。遅れているものも出る。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import type { StockData } from "@/lib/kotei/stock";
import { stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ShipForm from "@/components/board/ShipForm";
import ScrollWrap from "@/components/ScrollWrap";
import { loadPick, postActs } from "@/components/board/postActs";

type Me = { name: string; named: boolean; admin: boolean };
type Range = "today" | "week" | "next" | "all";
interface ShipRec {
  id: string;
  ship_date: string;
  qty: string;
  dest: string;
  contact: string;
  carrier: string;
  slip_no: string;
  note: string;
  from_stock: string;
  recorded_at: string;
  worker: string;
  canceled_at: string;
  mgmt_no: string;
  drawing_no: string;
  name: string;
  gone: number;
}

/** 今週（k=0）・来週（k=1）の日曜日 'YYYY/MM/DD' */
function weekEnd(today: string, k: number): string {
  const [y, m, d] = today.split("/").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = (t.getUTCDay() + 6) % 7; // 月曜から何日目か
  t.setUTCDate(t.getUTCDate() + 6 - back + 7 * k);
  return t.toISOString().slice(0, 10).replace(/-/g, "/");
}

function planOf(sp: BoardProc, it: BoardItem): { d: string; from: string } {
  if (sp.due) return { d: sp.due.slice(0, 10), from: "出荷の工程の納期" };
  if (sp.plan_start) return { d: sp.plan_start.slice(0, 10), from: "出荷の工程の開始予定" };
  return { d: (it.final_due || "").slice(0, 10), from: "品目の最終納期" };
}

const RANGES: [Range, string][] = [
  ["today", "今日まで"],
  ["week", "今週"],
  ["next", "来週まで"],
  ["all", "まだ出荷していない全部"],
];

export default function ShipView() {
  const [board, setBoard] = useState<(Board & { me: Me }) | null>(null);
  const [stock, setStock] = useState<StockData | null>(null);
  const [recs, setRecs] = useState<{ rows: ShipRec[]; more: boolean } | null>(null);
  const [limit, setLimit] = useState(100);
  const [range, setRangeState] = useState<Range>(() => {
    try {
      return (typeof window !== "undefined" && (localStorage.getItem("koutei:shipRange") as Range)) || "week";
    } catch {
      return "week";
    }
  });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [err, setErr] = useState("");
  const pick = loadPick();

  const load = useCallback(
    (lim: number) =>
      Promise.all([
        fetch("/api/board", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/stock", { cache: "no-store" }).then((x) => x.json()),
        fetch(`/api/shipments?limit=${lim}`, { cache: "no-store" }).then((x) => x.json()),
      ])
        .then(([b, s, r]) => {
          setBoard(b as Board & { me: Me });
          setStock(s as StockData);
          setRecs(r as { rows: ShipRec[]; more: boolean });
          setErr("");
        })
        .catch(() => setErr("読み込めませんでした。通信を確かめて、画面を開き直してください。")),
    []
  );
  useEffect(() => {
    load(100);
  }, [load]);

  const today = todayJst();
  const list = useMemo(() => {
    if (!board) return [];
    const lim = range === "today" ? today : range === "week" ? weekEnd(today, 0) : range === "next" ? weekEnd(today, 1) : "9999/99/99";
    return board.items
      .filter((it) => it.hidden !== "1" && it.case_hidden !== "1")
      .map((it) => {
        const role = stockRole(it.kubun, it.procs);
        const sp = role ? it.procs.find((p) => p.id === role.ship) : undefined;
        return sp && !sp.done_at ? { it, sp, pl: planOf(sp, it), cur: it.procs.find((p) => !p.done_at) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x && (range === "all" || (!!x.pl.d && x.pl.d <= lim)))
      .sort((a, b) => (a.pl.d || "9999").localeCompare(b.pl.d || "9999") || a.it.mgmt_no.localeCompare(b.it.mgmt_no, "ja"));
  }, [board, range, today]);

  if (!board || !stock || !recs) return <p className="py-8 text-base text-ink-sub">{err || "読み込み中…"}</p>;
  const worker = board.me.named ? board.me.name : pick;
  const stockBy: Record<string, number> = {};
  stock.rows.forEach((r) => (stockBy[r.dw] = stock.main === "画面" ? r.scr : r.mnet));

  const run = async (acts: Act[], msg: string) => {
    if (!worker) {
      setToast({ text: "工程一覧の画面の上で、作業者を選んでから押してください。", bad: true });
      return false;
    }
    setBusy(true);
    const r = await postActs(acts, board.me.named ? undefined : pick, msg);
    setToast({ text: r.text, bad: !r.ok });
    await load(limit);
    setBusy(false);
    return r.ok;
  };
  const setRange = (r: Range) => {
    setRangeState(r);
    try {
      localStorage.setItem("koutei:shipRange", r);
    } catch {
      // 覚えられなくても動く
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">出荷</h1>
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-2xl items-start gap-4 rounded-lg border-2 bg-white p-4 text-base shadow-lg ${toast.bad ? "border-danger text-danger" : "border-ok"}`}
        >
          <p className="whitespace-pre-wrap">{toast.text}</p>
          <button type="button" onClick={() => setToast(null)} className="ml-auto min-h-11 rounded-lg border border-line px-4 text-base text-ink">
            閉じる
          </button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {RANGES.map(([k, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setRange(k)}
            aria-pressed={range === k}
            className={`min-h-11 rounded-lg border px-4 text-base ${range === k ? "border-accent bg-accent font-bold text-white" : "border-accent bg-white text-accent"}`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-sub">予定日は「出荷の工程の納期 → 開始予定 → 品目の最終納期」の順で、入っているもの。遅れているものも出ます。</p>
      <p className="mt-2 text-base">
        {list.length}件。「出荷を記録」で、出荷日・数・配送業者・伝票番号を入れます（分けて出すときは何回でも）。
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {list.length === 0 && <p className="py-4 text-base text-ink-sub">この期間の出荷予定はありません。</p>}
        {list.map(({ it, sp, pl, cur }) => {
          const late = !!pl.d && pl.d < today;
          return (
            <div key={sp.id} className={`rounded-lg border bg-white ${late ? "border-l-8 border-l-danger border-line" : "border-line"}`}>
              <div className="flex flex-col gap-2 p-2 lg:flex-row lg:items-center">
                <div className="min-w-0 lg:w-96 lg:shrink-0">
                  <p className="text-base">
                    <b className={late ? "text-danger" : ""}>{pl.d || "予定なし"}</b>
                    {pl.d === today && <span className="ml-2 rounded border border-line px-1 text-sm">今日</span>}
                    {late && <span className="ml-2 rounded border border-danger px-1 text-sm text-danger">遅れ</span>}
                    <b className="ml-2">{it.mgmt_no}</b>
                  </p>
                  <p className="text-base">
                    {it.drawing_no} {it.name}
                  </p>
                  <p className="text-sm text-ink-sub">
                    {it.customer}・{it.qty}個{sp.shipped ? `（出荷済み ${sp.shipped}）` : ""}・{pl.from}
                  </p>
                </div>
                <div className="min-w-0 flex-1 text-base">
                  <p>
                    出荷の工程：<b>{sp.name}</b>
                    {sp.started_at && <span className="ml-2 rounded border border-line px-1 text-sm">作業中</span>}
                    　今の工程：{cur ? cur.name : "－"}
                  </p>
                  <p className="text-sm text-ink-sub">
                    この図面番号の製品の数（{stock.main === "画面" ? "この画面" : "エムネット"}）：{stockBy[it.drawing_no] ?? 0}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setOpen(open === sp.id ? null : sp.id)} aria-expanded={open === sp.id} className="min-h-11 rounded-lg bg-accent px-4 text-base font-bold text-white">
                    出荷を記録
                  </button>
                </div>
              </div>
              {open === sp.id && (
                <div className="border-t-2 border-accent p-4">
                  <ShipForm pid={sp.id} name={sp.name} qty={Number(it.qty) || 0} shipped={sp.shipped} worker={worker} busy={busy} run={run} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-bold">出荷の記録（新しい順）</h2>
        <ScrollWrap className="mt-2">
          <table className="w-full text-base">
            <thead className="bg-card">
              <tr>
                {["出荷日", "社内管理番号", "図面番号・品名", "数", "配送業者", "伝票番号", "お届け先", "担当", "記録", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recs.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-2 py-2 text-ink-sub">
                    まだありません。
                  </td>
                </tr>
              )}
              {recs.rows.map((s) => (
                <tr key={s.id} className={`border-b border-line ${s.canceled_at ? "text-ink-sub line-through" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-1">{s.ship_date}</td>
                  <td className="whitespace-nowrap px-2 py-1">{s.gone ? "（消えた品目）" : s.mgmt_no}</td>
                  <td className="px-2 py-1">
                    {s.drawing_no} {s.name}
                  </td>
                  <td className="px-2 py-1 text-right">{s.qty}</td>
                  <td className="whitespace-nowrap px-2 py-1">{s.carrier}</td>
                  <td className="whitespace-nowrap px-2 py-1">{s.slip_no}</td>
                  <td className="px-2 py-1">{s.dest}</td>
                  <td className="whitespace-nowrap px-2 py-1">{s.contact}</td>
                  <td className="px-2 py-1 text-sm">
                    {s.recorded_at} {s.worker}
                    {s.from_stock === "1" && "（在庫から）"}
                    {s.note && <div>{s.note}</div>}
                    {s.canceled_at && <div className="no-underline">取り消し {s.canceled_at}</div>}
                  </td>
                  <td className="px-2 py-1">
                    {!s.canceled_at && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirm(`${s.ship_date} ${s.qty}個の出荷を取り消します。よろしいですか？`) && run([{ op: "unship", sid: s.id }], "出荷を取り消しました")}
                        className="min-h-11 whitespace-nowrap rounded-lg border border-danger bg-white px-4 text-base font-bold text-danger"
                      >
                        取り消す
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollWrap>
        {recs.more && (
          <button
            type="button"
            onClick={() => {
              setLimit(limit + 100);
              load(limit + 100);
            }}
            className="mt-2 min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent"
          >
            さらに100件出す
          </button>
        )}
        <p className="mt-2 text-sm text-ink-sub">
          <Link href="/board" className="text-accent underline">
            工程一覧へ
          </Link>
        </p>
      </section>
    </div>
  );
}
