"use client";

/**
 * 工程一覧（このアプリのいちばん大事な画面）。
 * 1行＝品目1つ。右に工程を順番どおり全部「札」で並べ、どこまで進んだかを一目で見せる。
 *   完了＝緑地「済」／作業中＝黄地「中」／次（最初の未完了でまだ始まっていない）＝青い枠「次」／まだ＝灰
 *   色だけで伝えないよう、札の頭に「済・中・次」の字を付ける（WEBデザインルール）。外注・出荷も字で付ける。
 * 上の「今の工程ごとの数」を押すと、その工程にいる品目だけに絞る（受注がいまどこにいるかの全体像）。
 * 見方は川﨑部長の試作の工程一覧（index.html rowHtml）と同じ。
 * 2段目：札を押すと、その品目の下に小窓（ProcPanel）が開き、開始・完了・作業を押せる。
 *   行の左のチェックで選んだ品目の「今の工程」を、まとめて完了にできる。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import { stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ScrollWrap from "@/components/ScrollWrap";
import ProcPanel, { type Send } from "./ProcPanel";

type Status = "open" | "done" | "all";
type Me = { name: string; named: boolean; admin: boolean };
type BoardRes = Board & { me: Me };

const PAGE = 200;

async function fetchBoard(): Promise<BoardRes> {
  const r = await fetch("/api/board", { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as BoardRes;
}

/** 操作の札（同じ操作が2回届いても1回分にするための印） */
const newOpId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function curOf(it: BoardItem): BoardProc | null {
  return it.procs.find((p) => !p.done_at) ?? null;
}
function isDone(it: BoardItem): boolean {
  return it.procs.length > 0 && !curOf(it);
}
const dateOnly = (s: string) => s.slice(0, 10);

function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem("koutei:filters") || "{}") as Partial<Filters>;
  } catch {
    return {};
  }
}
interface Filters {
  q: string;
  cur: string;
  status: Status;
  hidden: boolean;
  late: boolean;
}
const EMPTY: Filters = { q: "", cur: "", status: "open", hidden: false, late: false };

export default function BoardView() {
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // 絞り込みは端末ごとに覚える。データが届くまで画面には出ないので、最初から覚えた値で始める
  const [f, setFilters] = useState<Filters>(() => (typeof window === "undefined" ? EMPTY : { ...EMPTY, ...loadFilters() }));
  const [limit, setLimit] = useState(PAGE);
  const setF = (nf: Filters) => {
    setFilters(nf);
    setLimit(PAGE);
    try {
      localStorage.setItem("koutei:filters", JSON.stringify(nf));
    } catch {
      // 覚えられなくても動く
    }
  };
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ item: string; pid: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  // 共有メールでログインしたときだけ、端末で作業者を選ぶ（端末ごとに覚える）
  const [pick, setPickState] = useState<string>(() => {
    try {
      return typeof window === "undefined" ? "" : localStorage.getItem("koutei:worker") || "";
    } catch {
      return "";
    }
  });
  const setPick = (v: string) => {
    setPickState(v);
    try {
      localStorage.setItem("koutei:worker", v);
    } catch {
      // 覚えられなくても動く
    }
  };

  const show = useCallback((p: Promise<BoardRes>) => {
    return p
      .then((b) => {
        setBoard(b);
        setErr("");
      })
      .catch(() => setErr("読み込めませんでした。通信を確かめて「最新にする」を押してください。"));
  }, []);
  const load = async () => {
    setLoading(true);
    await show(fetchBoard());
    setLoading(false);
  };

  useEffect(() => {
    show(fetchBoard());
  }, [show]);

  // ほかの人が押した内容を見せるため、画面が出ている間は1分ごとに更新番号だけ確かめ、変わっていたら読み直す
  const ver = board?.ver;
  useEffect(() => {
    if (!ver) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/board?ver=${encodeURIComponent(ver)}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as BoardRes | { same: true };
        if (!("same" in j)) setBoard(j);
      } catch {
        // つながらないときは次の回にまた確かめる
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [ver]);

  const today = todayJst();
  const base = useMemo(() => {
    if (!board) return [];
    const q = f.q.trim().toLowerCase();
    return board.items.filter((it) => {
      if (!f.hidden && (it.hidden === "1" || it.case_hidden === "1")) return false;
      if (f.status === "open" && isDone(it)) return false;
      if (f.status === "done" && !isDone(it)) return false;
      if (f.late && !(it.final_due && dateOnly(it.final_due) < today && !isDone(it))) return false;
      if (q) {
        const hay = [it.mgmt_no, it.drawing_no, it.name, it.customer, it.barcode, it.customer_po].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [board, f.q, f.status, f.hidden, f.late, today]);

  // 今の工程ごとの数（絞り込みの「今の工程」をのぞいた数）
  const curCounts = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach((it) => {
      const c = curOf(it);
      const k = c ? c.name : isDone(it) ? "（全部終わった）" : "（工程なし）";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const rows = useMemo(() => {
    const list = f.cur
      ? base.filter((it) => {
          const c = curOf(it);
          const k = c ? c.name : isDone(it) ? "（全部終わった）" : "（工程なし）";
          return k === f.cur;
        })
      : base;
    return list.slice().sort((a, b) => {
      const da = a.final_due || "9999";
      const dbb = b.final_due || "9999";
      return da < dbb ? -1 : da > dbb ? 1 : a.mgmt_no.localeCompare(b.mgmt_no, "ja");
    });
  }, [base, f.cur]);

  if (!board) {
    return <p className="py-8 text-base text-ink-sub">{err || "読み込み中…"}</p>;
  }
  const me = board.me;
  const worker = me.named ? me.name : pick;

  const send: Send = async (acts: Act[], doneMsg: string) => {
    if (!worker) {
      setToast({ text: "画面の上で作業者を選んでから押してください。", bad: true });
      return false;
    }
    try {
      const r = await fetch("/api/acts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acts, worker: me.named ? undefined : pick, opId: newOpId() }),
      });
      const j = (await r.json()) as { error?: string; skipped?: string[] };
      if (!r.ok) {
        setToast({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）", bad: true });
        await show(fetchBoard());
        return false;
      }
      setToast({ text: [doneMsg, ...(j.skipped ?? [])].join("\n") });
      await show(fetchBoard());
      return true;
    } catch {
      setToast({ text: "通信できませんでした。保存されたか分からないので、「最新にする」で確かめてください。", bad: true });
      return false;
    }
  };

  // あなたの作業中（終えていない作業）
  const myWorks = board.items.flatMap((it) =>
    it.procs.flatMap((p) => p.works.filter((w) => !w.ended_at && w.worker === worker).map((w) => ({ it, p, w })))
  );

  // まとめて完了：選んだ品目の「今の工程」を、品目の数量で完了にする（出荷の工程は残りの数で出荷を記録）
  const bulk = async () => {
    const targets = rows
      .filter((it) => sel.has(it.id))
      .map((it) => ({ it, c: curOf(it) }))
      .filter((x): x is { it: BoardItem; c: BoardProc } => !!x.c);
    if (!targets.length) return;
    const lines = targets.slice(0, 15).map((x) => `・${x.it.mgmt_no} ${x.it.drawing_no}：${x.c.name}`);
    const more = targets.length > 15 ? "\n…" : "";
    if (!confirm(`${targets.length}件の「今の工程」を完了にします（数は品目の数量）。\n${lines.join("\n")}${more}\nよろしいですか？`)) return;
    const acts: Act[] = targets.map(({ it, c }) => {
      const isShip = stockRole(it.kubun, it.procs)?.ship === c.id;
      const qty = isShip ? String(Math.max(0, (Number(it.qty) || 0) - c.shipped)) : c.done_qty || it.qty || "0";
      return { op: "done", pid: c.id, qty, ng: c.defect_qty, why: c.defect_reason, ...(isShip ? { ship: { ship_date: todayJst() } } : {}) };
    });
    if (await send(acts, `${targets.length}件を完了にしました`)) setSel(new Set());
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-2xl font-bold">工程一覧</h1>
        <p className="text-sm text-ink-sub">
          {board.lastImport ? `エムネットから最後に取り込んだ日時：${board.lastImport.at}` : "まだエムネットから取り込んでいません"}
        </p>
        <button type="button" onClick={load} disabled={loading} className="ml-auto min-h-11 rounded-lg border border-accent px-4 text-base font-bold text-accent disabled:opacity-50">
          {loading ? "読み込み中…" : "最新にする"}
        </button>
      </div>
      {err && <p className="mt-2 rounded border border-danger bg-white p-2 text-base text-danger">{err}</p>}
      {toast && (
        // 小窓で押したときも見えるよう、画面の下の方に重ねて出す（右下の「ご意見」ボタンにかからない高さ）
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
      <div className="mt-2 flex flex-wrap items-center gap-4 text-base">
        {me.named ? (
          <p>
            作業者：<b>{me.name}</b>（ログインした人）
          </p>
        ) : (
          <label className={`flex items-center gap-2 rounded p-2 ${pick ? "" : "border-2 border-danger"}`}>
            作業者（共有のメールなので選んでください）
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base">
              <option value="">（選ぶ）</option>
              {board.lists.workers.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {myWorks.length > 0 && (
        <section className="mt-2 rounded-lg border border-[#B08A00] bg-warn-bg p-2">
          <h2 className="text-base font-bold">
            {worker}さんの作業中（{myWorks.length}件）
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {myWorks.map(({ it, p, w }) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setF({ ...f, q: it.mgmt_no, cur: "", status: "all" });
                  setPanel({ item: it.id, pid: p.id });
                }}
                className="min-h-11 rounded-lg border border-line bg-white px-4 text-left text-base"
              >
                <b>{it.mgmt_no}</b> {p.name}
                <span className="ml-2 text-sm text-ink-sub">{w.started_at.slice(5)}〜</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 絞り込み */}
      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-card p-4">
        <label className="flex flex-col gap-2 text-sm">
          さがす（管理番号・図面番号・品名・顧客・バーコード）
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            className="min-h-11 w-72 max-w-full rounded border border-ink-sub bg-white px-2 text-base"
            placeholder="例：1334 / ABC-123"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          状態
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base">
            <option value="open">終わっていない</option>
            <option value="done">全部終わった</option>
            <option value="all">すべて</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={f.late} onChange={(e) => setF({ ...f, late: e.target.checked })} className="h-5 w-5" />
          納期遅れだけ
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} className="h-5 w-5" />
          隠したものも出す
        </label>
        <button type="button" onClick={() => setF(EMPTY)} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          条件を消す
        </button>
      </div>

      {/* 今の工程ごとの数 */}
      <section className="mt-4">
        <h2 className="text-xl font-bold">いまどの工程にいるか（{base.length}件）</h2>
        <p className="mt-2 text-sm text-ink-sub">押すと、その工程にいる品目だけに絞ります。もう一度押すと元に戻ります。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {curCounts.map(([name, n]) => {
            const on = f.cur === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setF({ ...f, cur: on ? "" : name })}
                className={`min-h-11 rounded-lg border px-4 text-base ${on ? "border-accent bg-accent font-bold text-white" : "border-line bg-white"}`}
                aria-pressed={on}
              >
                {name} <span className="font-bold">{n}</span>
              </button>
            );
          })}
        </div>
      </section>

      <Legend />

      {/* 一覧 */}
      <div className="mt-4 flex flex-col gap-2">
        {rows.length === 0 && <p className="py-8 text-base text-ink-sub">当てはまる品目がありません。</p>}
        {rows.slice(0, limit).map((it) => (
          <ItemRowView
            key={it.id}
            it={it}
            today={today}
            open={open === it.id}
            onToggle={() => setOpen(open === it.id ? null : it.id)}
            panelPid={panel?.item === it.id ? panel.pid : null}
            onChip={(pid) => setPanel(panel?.item === it.id && panel.pid === pid ? null : { item: it.id, pid })}
            checked={sel.has(it.id)}
            onCheck={(on) => {
              const n = new Set(sel);
              if (on) n.add(it.id);
              else n.delete(it.id);
              setSel(n);
            }}
            panel={(p) => <ProcPanel key={p.id} it={it} p={p} me={me} worker={worker} lists={board.lists} send={send} onClose={() => setPanel(null)} />}
            admin={me.admin}
          />
        ))}
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="mt-4 min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          さらに{PAGE}件出す（あと{rows.length - limit}件）
        </button>
      )}
      {sel.size > 0 && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-4 border-t border-line bg-white py-4">
          <p className="text-base">{sel.size}件を選んでいます</p>
          <button type="button" onClick={bulk} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white">
            今の工程をまとめて完了
          </button>
          <button type="button" onClick={() => setSel(new Set())} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
            選ぶのをやめる
          </button>
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-sub">札の見方：</span>
      <span className={`${CHIP} ${CHIP_STYLE.done}`}>済 完了</span>
      <span className={`${CHIP} ${CHIP_STYLE.doing}`}>中 作業中</span>
      <span className={`${CHIP} ${CHIP_STYLE.next}`}>次 次の工程</span>
      <span className={`${CHIP} ${CHIP_STYLE.todo}`}>まだ</span>
      <span className="text-ink-sub">「外注」＝外に出す工程・名前に「出荷」が無い出荷の工程には「出荷」と付けます</span>
    </div>
  );
}

const CHIP = "inline-flex min-h-11 flex-col justify-center rounded border px-2 py-1 text-left text-base leading-tight";
const CHIP_STYLE = {
  done: "border-ok bg-[#E6F2EC] text-ink", // 薄い緑地に黒文字
  doing: "border-[#B08A00] bg-warn-bg font-bold text-ink", // 注意の黄色地に黒文字
  next: "border-2 border-accent bg-white font-bold text-ink",
  todo: "border-line bg-card text-ink-sub",
};
const MARK = { done: "済", doing: "中", next: "次", todo: "" };

function ItemRowView({
  it,
  today,
  open,
  onToggle,
  panelPid,
  onChip,
  checked,
  onCheck,
  panel,
  admin,
}: {
  it: BoardItem;
  today: string;
  open: boolean;
  onToggle: () => void;
  panelPid: string | null;
  onChip: (pid: string) => void;
  checked: boolean;
  onCheck: (on: boolean) => void;
  panel: (p: BoardProc) => React.ReactNode;
  admin: boolean;
}) {
  const cur = curOf(it);
  const done = isDone(it);
  const late = !!it.final_due && dateOnly(it.final_due) < today && !done;
  // 出荷の工程（名前に「出荷」が無いときは最後の工程＝「目視、梱包」など。在庫の計算と同じ決め方）
  const shipId = stockRole(it.kubun, it.procs)?.ship ?? "";
  return (
    <div className={`rounded-lg border bg-white ${late ? "border-l-8 border-l-danger border-line" : "border-line"}`}>
      <div className="flex flex-col gap-2 p-2 lg:flex-row">
        <div className="flex min-w-0 gap-2 lg:w-80 lg:shrink-0">
        {cur ? (
          <label className="flex min-h-11 min-w-11 shrink-0 items-start justify-center pt-1" title="今の工程をまとめて完了するときに選ぶ">
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} className="h-5 w-5" aria-label={`${it.mgmt_no}を選ぶ`} />
          </label>
        ) : (
          <span className="min-w-11 shrink-0" />
        )}
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-col items-start gap-1 text-left" aria-expanded={open}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold">{it.mgmt_no || "（管理番号なし）"}</span>
            {it.kubun && <span className="rounded border border-line px-1 text-sm">{it.kubun}</span>}
            {(it.hidden === "1" || it.case_hidden === "1") && <span className="rounded border border-line px-1 text-sm">隠す</span>}
          </span>
          <span className="text-base">
            {it.drawing_no} {it.name}
          </span>
          <span className="text-sm text-ink-sub">
            {it.customer}
            {it.qty ? `・${it.qty}個` : ""}
            {it.final_due && (
              <>
                ・納期 <span className={late ? "font-bold text-danger" : ""}>{dateOnly(it.final_due)}{late ? "（遅れ）" : ""}</span>
              </>
            )}
          </span>
        </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {it.procs.length === 0 && <span className="text-base text-ink-sub">工程なし</span>}
          {it.procs.map((p, k) => {
            const st = p.done_at ? "done" : p.started_at ? "doing" : cur && cur.id === p.id ? "next" : "todo";
            const sub = p.machine || (p.assignee && p.assignee !== "-" ? p.assignee : "");
            const ship = p.id === shipId && !p.name.includes("出荷");
            const tip = [
              p.name,
              p.assignee && `担当：${p.assignee}`,
              p.machine && `機械：${p.machine}`,
              p.plan_start && `開始予定：${p.plan_start}`,
              p.due && `納期：${p.due}`,
              p.started_at && `開始：${p.started_at}${p.started_by ? `（${p.started_by}）` : ""}`,
              p.done_at && `完了：${p.done_at}${p.done_by ? `（${p.done_by}）` : ""}`,
              p.working.length ? `作業中：${p.working.join("・")}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <span key={p.id} className="flex items-center gap-1">
                {k > 0 && <span className="text-ink-sub" aria-hidden>›</span>}
                <button
                  type="button"
                  onClick={() => onChip(p.id)}
                  aria-expanded={panelPid === p.id}
                  className={`${CHIP} ${CHIP_STYLE[st]} ${panelPid === p.id ? "outline-2 outline-offset-2 outline-accent" : ""}`}
                  title={tip}
                >
                  <span>
                    {MARK[st] && <span className="mr-1">{MARK[st]}</span>}
                    {p.in_out === "外注" && <span className="mr-1 text-sm">外注</span>}
                    {p.name}
                    {ship && <span className="ml-1 text-sm">出荷</span>}
                  </span>
                  {sub && <span className="text-sm font-normal text-ink-sub">{sub}</span>}
                  {p.working.length > 0 && <span className="text-sm font-bold">作業中{p.working.length}人</span>}
                </button>
              </span>
            );
          })}
        </div>
      </div>
      {panelPid && (() => {
        const p = it.procs.find((x) => x.id === panelPid);
        return p ? panel(p) : null;
      })()}
      {open && <ItemDetail it={it} admin={admin} />}
    </div>
  );
}

function ItemDetail({ it, admin }: { it: BoardItem; admin: boolean }) {
  return (
    <div className="border-t border-line p-4">
      {admin && (
        <Link href={`/cases?id=${encodeURIComponent(it.case_id)}`} className="mb-4 inline-flex min-h-11 items-center rounded-lg border border-accent px-4 text-base font-bold text-accent">
          この案件を直す（品目・工程の並び）
        </Link>
      )}
      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-base sm:grid-cols-2 lg:grid-cols-3">
        <Info k="バーコード番号" v={it.barcode} />
        <Info k="顧客発注番号" v={it.customer_po} />
        <Info k="受注日" v={it.order_date} />
        <Info k="営業担当" v={it.sales_rep} />
        <Info k="最終納期" v={it.final_due} />
        <Info k="数量" v={it.qty} />
      </dl>
      <ScrollWrap className="mt-4">
        <table className="w-full text-base">
          <thead className="bg-card">
            <tr>
              {["順", "社内外注", "工程", "担当", "機械", "開始予定", "納期", "開始", "完了", "完成数量", "不良数", "コメント・備考"].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {it.procs.map((p) => (
              <tr key={p.id} className="whitespace-nowrap border-b border-line">
                <td className="px-2 py-1 text-right">{p.seq}</td>
                <td className="px-2 py-1">{p.in_out}</td>
                <td className="px-2 py-1 font-bold">{p.name}</td>
                <td className="px-2 py-1">{p.assignee}</td>
                <td className="px-2 py-1">{p.machine}</td>
                <td className="whitespace-nowrap px-2 py-1">{p.plan_start}</td>
                <td className="whitespace-nowrap px-2 py-1">{p.due}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  {p.started_at}
                  {p.started_by && <span className="text-sm text-ink-sub">（{p.started_by}）</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {p.done_at}
                  {p.done_by && <span className="text-sm text-ink-sub">（{p.done_by}）</span>}
                </td>
                <td className="px-2 py-1 text-right">{p.done_qty}</td>
                <td className="px-2 py-1 text-right">{p.defect_qty}</td>
                <td className="min-w-64 whitespace-normal px-2 py-1">{[p.comment, p.note].filter(Boolean).join(" ／ ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollWrap>
      {(it.knowhow || it.note) && (
        <div className="mt-4 text-base">
          {it.knowhow && <p className="whitespace-pre-wrap">ノウハウ：{it.knowhow}</p>}
          {it.note && <p className="whitespace-pre-wrap">備考：{it.note}</p>}
        </div>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-sub">{k}</dt>
      <dd>{v || "－"}</dd>
    </div>
  );
}
