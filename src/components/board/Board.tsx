"use client";

/**
 * 工程一覧（このアプリのいちばん大事な画面）。
 * 1行＝品目1つ。右に工程を順番どおり全部「札」で並べ、どこまで進んだかを一目で見せる。
 *   完了＝緑地「済」／作業中＝黄地「中」／次（最初の未完了でまだ始まっていない）＝青い枠「次」／まだ＝灰
 *   色だけで伝えないよう、札の頭に「済・中・次」の字を付ける（WEBデザインルール）。外注・出荷も字で付ける。
 * 上の「今の工程ごとの数」を押すと、その工程にいる品目だけに絞る（受注がいまどこにいるかの全体像）。
 * 見方は川﨑部長の試作の工程一覧（index.html rowHtml）と同じ。
 * 2段目：札を押すと、工程の大きい画面（ProcPanel・画面に重ねる）が開き、開始・完了・作業を押せる。
 * 品目（管理番号）を押すと、工程カード（ProcCards・エムネットと同じ並び）が開く（2026-11-22）。
 *   行の左のチェックで選んだ品目の「今の工程」を、まとめて完了にできる。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import { isItemDone, stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ScrollWrap from "@/components/ScrollWrap";
import ProcPanel, { type Send } from "./ProcPanel";
import MemoBox, { MemoMarks } from "./MemoBox";

type Status = "open" | "done" | "all";
type Me = { name: string; named: boolean; admin: boolean; email?: string };
type BoardRes = Board & { me: Me };

const PAGE = 200;

async function fetchBoard(): Promise<BoardRes> {
  const r = await fetch("/api/board", { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as BoardRes;
}

/** 操作の札（同じ操作が2回届いても1回分にするための印） */
const newOpId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 出荷されたら完了（出荷の工程が済めば、ほかの工程が残っていても完了）。完了した品目に「今の工程」は無い */
function isDone(it: BoardItem): boolean {
  return isItemDone(it.kubun, it.procs);
}
function curOf(it: BoardItem): BoardProc | null {
  return isDone(it) ? null : (it.procs.find((p) => !p.done_at) ?? null);
}
const dateOnly = (s: string) => s.slice(0, 10);

function loadFilters() {
  try {
    return JSON.parse(localStorage.getItem("koutei:filters") || "{}") as Partial<Filters>;
  } catch {
    return {};
  }
}
type Due = "" | "today" | "week" | "nextweek" | "month" | "range";
interface Filters {
  q: string;
  cur: string;
  status: Status;
  hidden: boolean;
  late: boolean;
  /** 客先（顧客名と同じもの） */
  cust: string;
  /** 納期で絞る（今週・来週などは開いた日から数える＝URLを後で開いてもその日の「今週」） */
  due: Due;
  from: string;
  to: string;
  /** 機械（まだ終わっていない工程にこの機械があるもの） */
  mc: string;
}
const EMPTY: Filters = { q: "", cur: "", status: "open", hidden: false, late: false, cust: "", due: "", from: "", to: "", mc: "" };

/**
 * 絞り方をURLに入れる（2026-11-27 川﨑部長・案A）。
 * そのURLをブックマーク・LINE WORKS で送れば、開いた人も同じ絞り方で見られる。決まった値（EMPTY）と同じものは入れない。
 *   q=言葉（スペースで区切ると全部を含むもの）・cur=今の工程・st=open/done/all・late=1・hidden=1
 *   cust=客先・due=today/week/nextweek/month/range（range のときだけ from・to＝YYYY-MM-DD）・mc=機械
 */
const DUES: Due[] = ["", "today", "week", "nextweek", "month", "range"];
function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.cur) p.set("cur", f.cur);
  if (f.status !== "open") p.set("st", f.status);
  if (f.late) p.set("late", "1");
  if (f.hidden) p.set("hidden", "1");
  if (f.cust) p.set("cust", f.cust);
  if (f.due) p.set("due", f.due);
  if (f.due === "range" && f.from) p.set("from", f.from);
  if (f.due === "range" && f.to) p.set("to", f.to);
  if (f.mc) p.set("mc", f.mc);
  const s = p.toString();
  return s ? `?${s}` : "";
}
/** URLに絞り方が入っていれば読む（無ければ null）。受注一覧から ?q=管理番号 だけで来たときは「すべて」から探す（前と同じ） */
function filtersFromQuery(search: string): Filters | null {
  const p = new URLSearchParams(search);
  const keys = ["q", "cur", "st", "late", "hidden", "cust", "due", "from", "to", "mc"];
  if (!keys.some((k) => p.has(k))) return null;
  const st = p.get("st");
  const due = (p.get("due") || "") as Due;
  return {
    q: p.get("q") || "",
    cur: p.get("cur") || "",
    status: st === "open" || st === "done" || st === "all" ? st : p.has("q") ? "all" : "open",
    late: p.get("late") === "1",
    hidden: p.get("hidden") === "1",
    cust: p.get("cust") || "",
    due: DUES.includes(due) ? due : "",
    from: p.get("from") || "",
    to: p.get("to") || "",
    mc: p.get("mc") || "",
  };
}

/** 'YYYY/MM/DD' に日数を足す */
function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10).replace(/-/g, "/");
}
/** 納期の絞りの範囲 [から, まで]（'YYYY/MM/DD'・空＝決めない）。週は月曜はじまり */
function dueRange(f: Filters, today: string): [string, string] | null {
  if (!f.due) return null;
  const [y, m, d] = today.split("/").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 月=0 … 日=6
  const mon = addDays(today, -wd);
  if (f.due === "today") return ["", today];
  if (f.due === "week") return [mon, addDays(mon, 6)];
  if (f.due === "nextweek") return [addDays(mon, 7), addDays(mon, 13)];
  if (f.due === "month") {
    const next = m === 12 ? `${y + 1}/01/01` : `${y}/${String(m + 1).padStart(2, "0")}/01`;
    return [`${today.slice(0, 8)}01`, addDays(next, -1)];
  }
  return [f.from.replace(/-/g, "/"), f.to.replace(/-/g, "/")];
}

export default function BoardView() {
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // 絞り込みは端末ごとに覚える。データが届くまで画面には出ないので、最初から覚えた値で始める
  // URLに絞り方が入っていればそれを使う（ブックマーク・送られたURL・受注一覧の ?q=管理番号）。無ければ端末が覚えた絞り方
  const [f, setFilters] = useState<Filters>(() => {
    if (typeof window === "undefined") return EMPTY;
    return filtersFromQuery(window.location.search) ?? { ...EMPTY, ...loadFilters() };
  });
  const [limit, setLimit] = useState(PAGE);
  // 今の絞り方をいつもURLに映す（画面を読み直さずに書き換える）
  useEffect(() => {
    try {
      const url = window.location.pathname + filtersToQuery(f) + window.location.hash;
      if (url !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", url);
    } catch {
      // 書き換えられなくても絞り込みは動く
    }
  }, [f]);
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
    // 言葉はスペース（全角も）で区切ると、全部を含むものだけ
    const words = f.q.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
    const dr = dueRange(f, today);
    return board.items.filter((it) => {
      if (!f.hidden && (it.hidden === "1" || it.case_hidden === "1")) return false;
      if (f.status === "open" && isDone(it)) return false;
      if (f.status === "done" && !isDone(it)) return false;
      if (f.late && !(it.final_due && dateOnly(it.final_due) < today && !isDone(it))) return false;
      if (f.cust && it.customer !== f.cust) return false;
      if (f.mc && !it.procs.some((p) => !p.done_at && p.machine === f.mc)) return false;
      if (dr) {
        const d = it.final_due ? dateOnly(it.final_due) : "";
        if (!d) return false;
        if (dr[0] && d < dr[0]) return false;
        if (dr[1] && d > dr[1]) return false;
      }
      if (words.length) {
        const hay = [it.mgmt_no, it.drawing_no, it.name, it.customer, it.barcode, it.customer_po].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [board, f, today]);

  // 客先・機械の選ぶ欄の中身（今のデータにあるもの）
  const choices = useMemo(() => {
    const cs = new Set<string>();
    const ms = new Set<string>();
    board?.items.forEach((it) => {
      if (it.customer) cs.add(it.customer);
      it.procs.forEach((p) => p.machine && p.machine !== "-" && ms.add(p.machine));
    });
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "ja"));
    return { cust: sort(cs), mc: sort(ms) };
  }, [board]);

  const copyUrl = async () => {
    const url = window.location.origin + window.location.pathname + filtersToQuery(f);
    try {
      await navigator.clipboard.writeText(url);
      setToast({ text: "この絞り方のURLをコピーしました。\nブックマークや LINE WORKS に貼ると、開いたときにこの絞り方で出ます。" });
    } catch {
      window.prompt("このURLをコピーしてください（ブックマークや LINE WORKS に貼れます）", url);
    }
  };

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

  // 工程カードの大きいボタン（案A）：まだ→開始／作業中→完了（数は作業の合計か品目の数量）。
  // 出荷の工程と、終えていない作業がある工程は、数を入れるので工程の大きい画面を開く
  const quick = async (it: BoardItem, p: BoardProc) => {
    const isShip = stockRole(it.kubun, it.procs)?.ship === p.id;
    if (isShip || p.works.some((w) => !w.ended_at)) {
      setPanel({ item: it.id, pid: p.id });
      return;
    }
    if (!p.started_at) {
      await send([{ op: "start", pid: p.id }], `${p.name}を開始にしました`);
      return;
    }
    const sum = (h: "good_qty" | "defect_qty") => String(Math.round(p.works.reduce((t, w) => t + (Number(w[h]) || 0), 0) * 1000) / 1000);
    const qty = p.works.length ? sum("good_qty") : p.done_qty || it.qty || "0";
    const ng = p.works.length ? sum("defect_qty") : p.defect_qty;
    if (!confirm(`${it.mgmt_no}\n${p.name}を完了にします（完成 ${qty}${Number(ng) > 0 ? `・不良 ${ng}` : ""}）。\n数を直すときは「キャンセル」を押して、工程の名前を押してください。`)) return;
    await send([{ op: "done", pid: p.id, qty, ng: Number(ng) > 0 ? ng : "", why: p.defect_reason }], `${p.name}を完了にしました`);
  };

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
          さがす（管理番号・図面番号・品名・顧客・バーコード。スペースで区切ると全部を含むもの）
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            className="min-h-11 w-72 max-w-full rounded border border-ink-sub bg-white px-2 text-base"
            placeholder="例：島津 ハウジング"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          客先
          <select value={f.cust} onChange={(e) => setF({ ...f, cust: e.target.value })} className="min-h-11 max-w-64 rounded border border-ink-sub bg-white px-2 text-base">
            <option value="">すべて</option>
            {f.cust && !choices.cust.includes(f.cust) && <option value={f.cust}>{f.cust}</option>}
            {choices.cust.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          納期（品目の最終納期）
          <select value={f.due} onChange={(e) => setF({ ...f, due: e.target.value as Due })} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base">
            <option value="">すべて</option>
            <option value="today">今日まで（遅れも入る）</option>
            <option value="week">今週（月〜日）</option>
            <option value="nextweek">来週（月〜日）</option>
            <option value="month">今月</option>
            <option value="range">日付で決める</option>
          </select>
        </label>
        {f.due === "range" && (
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-2 text-sm">
              から
              <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base" />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              まで
              <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base" />
            </label>
          </span>
        )}
        <label className="flex flex-col gap-2 text-sm">
          機械（まだの工程にあるもの）
          <select value={f.mc} onChange={(e) => setF({ ...f, mc: e.target.value })} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base">
            <option value="">すべて</option>
            {f.mc && !choices.mc.includes(f.mc) && <option value={f.mc}>{f.mc}</option>}
            {choices.mc.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
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
        <button type="button" onClick={copyUrl} className="min-h-11 rounded-lg bg-accent px-4 text-base font-bold text-white" title="ブックマークや LINE WORKS に貼ると、この絞り方ですぐ開けます">
          🔗 この絞り方のURLをコピー
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-sub">
        絞り方は画面の上のURLにも入っています。よく使う絞り方は、このままブックマークすると次から1回で開けます（「今週」などは開いた日から数えます）。
      </p>

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
            panel={(p) => <ProcPanel key={p.id} it={it} p={p} me={me} worker={worker} lists={board.lists} send={send} onClose={() => setPanel(null)} onMemoSaved={() => show(fetchBoard())} />}
            memo={() => <MemoBox it={it} me={me} worker={worker} onSaved={() => show(fetchBoard())} />}
            admin={me.admin}
            onQuick={(p) => quick(it, p)}
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
  onQuick,
  memo,
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
  onQuick: (p: BoardProc) => void;
  memo: () => React.ReactNode;
}) {
  const cur = curOf(it);
  const done = isDone(it);
  const late = !!it.final_due && dateOnly(it.final_due) < today && !done;
  // 出荷の工程（名前に「出荷」が無いときは最後の工程＝「目視、梱包」など。在庫の計算と同じ決め方）
  const shipId = stockRole(it.kubun, it.procs)?.ship ?? "";
  return (
    // 開いている案件は、青い太枠で囲み、見出しの帯を薄い青にする（どこからどこまでが1つの案件かを分かりやすく・2026-11-27）
    <div className={`rounded-lg bg-white ${open ? "my-2 border-4 border-accent shadow-md" : "border border-line"} ${late ? "border-l-8 border-l-danger" : ""}`}>
      {/* 帯のどこを押しても開く・閉じる（工程の札・チェック・ボタンは、それぞれの働きのまま） */}
      <div
        className={`flex cursor-pointer flex-col gap-2 p-2 lg:flex-row ${open ? "rounded-t bg-[#EAF1FB]" : "hover:bg-card"}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,a,input,label,select,textarea")) return;
          onToggle();
        }}
      >
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
            <span className="text-base text-accent" aria-hidden>{open ? "▼" : "▶"}</span>
            <span className="text-base font-bold">{it.mgmt_no || "（管理番号なし）"}</span>
            {open && <span className="rounded bg-accent px-2 text-sm font-bold text-white">開いています</span>}
            {it.kubun && <span className="rounded border border-line px-1 text-sm">{it.kubun}</span>}
            {(it.hidden === "1" || it.case_hidden === "1") && <span className="rounded border border-line px-1 text-sm">隠す</span>}
            <MemoMarks it={it} />
          </span>
          <span className="text-base">
            {it.drawing_no} {it.name}
          </span>
          <span className="text-sm text-ink-sub">
            {it.customer}
            {it.qty ? `・${it.qty}個` : ""}
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
        <BandSide it={it} cur={cur} shipId={shipId} late={late} />
      </div>
      {panelPid && (() => {
        const p = it.procs.find((x) => x.id === panelPid);
        return p ? panel(p) : null;
      })()}
      {open && (
        <>
          <ItemDetail it={it} admin={admin} cur={cur} shipId={shipId} onOpen={onChip} onQuick={onQuick} memo={memo} />
          <div className="flex justify-center border-t border-line bg-[#EAF1FB] p-2">
            <button type="button" onClick={onToggle} className="min-h-11 rounded-lg border border-accent bg-white px-8 text-base font-bold text-accent">
              ▲ {it.mgmt_no} を閉じる
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 'YYYY/MM/DD…' → 'YY/MM/DD(曜)'（エムネットの一覧と同じ短い形＋曜日） */
function shortDate(s: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(s);
  if (!m) return s;
  const w = "日月火水木金土"[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
  return `${m[1].slice(2)}/${m[2]}/${m[3]}(${w})`;
}

/**
 * 帯の右端（2026-11-27 川﨑部長「出荷日を分かりやすく・備考を右端に」エムネットの一覧と同じ並び）。
 * 左＝日付：最終納期（大きく・遅れは赤＋「遅れ」）・今の工程の納期・出荷（出荷した日、まだなら出荷の工程の納期）。
 * 右＝ノウハウ欄（エムネットでオーダー番号・出荷日などを書いている所）と備考を全文。「出荷日」を含む行は太字。
 */
function BandSide({ it, cur, shipId, late }: { it: BoardItem; cur: BoardProc | null; shipId: string; late: boolean }) {
  const ship = it.procs.find((p) => p.id === shipId);
  const shipped = ship && ship.ships.length ? ship.ships[ship.ships.length - 1].ship_date : "";
  const curDue = cur && cur.id !== shipId && cur.due ? cur.due : "";
  const shipDue = ship?.due || "";
  const lines = [it.knowhow, it.note && `備考：${it.note}`].filter(Boolean).join("\n").split(/\r?\n/);
  const text = lines.some((l) => l.trim());
  return (
    <div className="flex gap-2 border-t border-line pt-2 lg:w-[26rem] lg:shrink-0 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
      <dl className="w-36 shrink-0 text-sm leading-tight">
        <dt className="text-ink-sub">最終納期</dt>
        <dd className={`text-lg font-bold ${late ? "text-danger" : ""}`}>
          {it.final_due ? shortDate(it.final_due) : "－"}
          {late && <span className="ml-1 rounded bg-danger px-1 text-sm text-white">遅れ</span>}
        </dd>
        {curDue && (
          <>
            <dt className="mt-1 text-ink-sub">今の工程の納期</dt>
            <dd className="text-base font-bold">{shortDate(curDue)}</dd>
          </>
        )}
        {shipped ? (
          <>
            <dt className="mt-1 text-ink-sub">出荷した日</dt>
            <dd className="text-base font-bold">済 {shortDate(shipped)}</dd>
          </>
        ) : (
          shipDue && (
            <>
              <dt className="mt-1 text-ink-sub">出荷の予定</dt>
              <dd className="text-base font-bold">{shortDate(shipDue)}</dd>
            </>
          )
        )}
      </dl>
      <div className="min-w-0 flex-1 break-words text-base leading-snug" title="ノウハウ欄・備考（エムネットのCSV取り込みで入れ替わります）">
        {text ? (
          lines.map((l, k) => (
            <div key={k} className={l.includes("出荷日") ? "font-bold" : ""}>
              {l || "\u00a0"}
            </div>
          ))
        ) : (
          <span className="text-ink-sub">ノウハウ・備考なし</span>
        )}
      </div>
    </div>
  );
}

/**
 * 品目を開いたときの工程カード（案A・エムネットと同じ並び・2026-11-22 川﨑）。
 * 1枚＝1工程。状態・機械・担当・数・納期・完了日と、大きいボタン1つ（まだ→開始・作業中→完了・完了→開く）。
 * 右の細い列が作業の記録（だれが・いつ・何個）。カードの名前や作業の記録を押すと、工程の大きい画面（ProcPanel）が開いて直せる。
 */
function ProcCards({ it, cur, shipId, onOpen, onQuick }: { it: BoardItem; cur: BoardProc | null; shipId: string; onOpen: (pid: string) => void; onQuick: (p: BoardProc) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {it.procs.map((p, k) => {
        const st = p.done_at ? "done" : p.started_at ? "doing" : cur && cur.id === p.id ? "next" : "todo";
        const ship = p.id === shipId;
        const good = p.works.reduce((t, w) => t + (Number(w.good_qty) || 0), 0);
        const qty = p.done_qty || (good ? String(Math.round(good * 1000) / 1000) : "");
        const shown = p.works.slice(-3);
        const btn = p.done_at ? "開く" : !p.started_at ? "▶ 開始" : "✔ 完了";
        return (
          <div key={p.id} className={`flex rounded-lg border bg-white ${st === "doing" ? "border-2 border-[#B08A00]" : st === "next" ? "border-2 border-accent" : "border-line"}`}>
            <div className="min-w-0 flex-1 p-2">
              <button type="button" onClick={() => onOpen(p.id)} className="flex w-full items-start justify-between gap-2 text-left">
                <span className="font-bold">
                  {k + 1} {p.in_out === "外注" && <span className="text-sm">外注 </span>}
                  {p.name}
                  {ship && !p.name.includes("出荷") && <span className="ml-1 text-sm">出荷</span>}
                </span>
                <span className={`shrink-0 rounded border px-1 text-sm font-bold ${CHIP_STYLE[st]}`}>{{ done: "済 完了", doing: "中 作業中", next: "次", todo: "まだ" }[st]}</span>
              </button>
              <dl className="mt-1 grid grid-cols-[4rem_1fr] text-sm">
                <dt className="text-ink-sub">機械</dt>
                <dd>{p.machine || "－"}</dd>
                <dt className="text-ink-sub">担当</dt>
                <dd>{p.assignee && p.assignee !== "-" ? p.assignee : "－"}</dd>
                <dt className="text-ink-sub">数</dt>
                <dd>
                  {qty || "0"}
                  {it.qty ? ` / ${it.qty}` : ""}
                  {Number(p.defect_qty) > 0 && `・不良 ${p.defect_qty}`}
                </dd>
                <dt className="text-ink-sub">納期</dt>
                <dd>{p.due ? p.due.slice(0, 10) : "－"}</dd>
                <dt className="text-ink-sub">完了日</dt>
                <dd>{p.done_at ? p.done_at.slice(0, 10) : "未完了"}</dd>
              </dl>
              <button
                type="button"
                onClick={() => (p.done_at ? onOpen(p.id) : onQuick(p))}
                className={`mt-2 min-h-11 w-full rounded-lg px-2 text-base font-bold ${p.done_at ? "border border-accent bg-white text-accent" : "bg-accent text-white"}`}
              >
                {btn}
              </button>
            </div>
            <button type="button" onClick={() => onOpen(p.id)} className="w-24 shrink-0 border-l border-line bg-card p-1 text-left text-sm" title="押すと作業の記録を直せる">
              <span className="block text-ink-sub">作業</span>
              {p.works.length === 0 && <span className="block text-ink-sub">なし</span>}
              {p.works.length > shown.length && <span className="block text-ink-sub">ほか{p.works.length - shown.length}件</span>}
              {shown.map((w) => (
                <span key={w.id} className={`mt-1 block rounded border px-1 leading-snug ${w.ended_at ? "border-line bg-white" : "border-[#B08A00] bg-warn-bg"}`}>
                  <b>{w.worker}</b>
                  <br />
                  {w.started_at.slice(5, 10)} {w.started_at.slice(11)}
                  <br />〜{w.ended_at ? w.ended_at.slice(11) : <b>作業中</b>}
                  {w.good_qty && (
                    <>
                      <br />数 {w.good_qty}
                    </>
                  )}
                </span>
              ))}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ItemDetail({ it, admin, cur, shipId, onOpen, onQuick, memo }: { it: BoardItem; admin: boolean; cur: BoardProc | null; shipId: string; onOpen: (pid: string) => void; onQuick: (p: BoardProc) => void; memo: () => React.ReactNode }) {
  return (
    <div className="border-t border-line p-4">
      {admin && (
        <Link href={`/cases?id=${encodeURIComponent(it.case_id)}`} className="mb-4 inline-flex min-h-11 items-center rounded-lg border border-accent px-4 text-base font-bold text-accent">
          この案件を直す（品目・工程の並び）
        </Link>
      )}
      <ProcCards it={it} cur={cur} shipId={shipId} onOpen={onOpen} onQuick={onQuick} />
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-base sm:grid-cols-2 lg:grid-cols-3">
        <Info k="バーコード番号" v={it.barcode} />
        <Info k="顧客発注番号" v={it.customer_po} />
        <Info k="受注日" v={it.order_date} />
        <Info k="営業担当" v={it.sales_rep} />
        <Info k="最終納期" v={it.final_due} />
        <Info k="数量" v={it.qty} />
      </dl>
      <details className="mt-4">
        <summary className="cursor-pointer text-base text-accent">工程を表で見る（開始予定・開始・コメントなど）</summary>
      <ScrollWrap className="mt-2">
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
      </details>
      {(it.knowhow || it.note) && (
        <div className="mt-4 text-base">
          {it.knowhow && <p className="whitespace-pre-wrap">ノウハウ：{it.knowhow}</p>}
          {it.note && <p className="whitespace-pre-wrap">備考：{it.note}</p>}
        </div>
      )}
      {/* 案件メモ欄（品番の注意＋この案件のメモ・2026-11-24）。2026-11-28 下へ移し、ふだんは畳む（上下の案件を見やすく） */}
      <details className="group mt-4 rounded-lg border border-line">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-3 text-base font-bold text-accent [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block text-sm transition-transform group-open:rotate-90">▶</span>
          案件メモ（品番の注意・この案件のメモ）を開く
          {it.dnote?.body ? (
            <span className="rounded border border-[#B08A00] bg-warn-bg px-1 text-sm text-ink">⚠ 品番の注意あり</span>
          ) : (
            <span className="text-sm font-normal text-ink-sub">品番の注意なし</span>
          )}
          <span className="text-sm font-normal text-ink-sub">💬 メモ {it.memos.length}件</span>
        </summary>
        <div className="border-t border-line p-3">{memo()}</div>
      </details>
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
