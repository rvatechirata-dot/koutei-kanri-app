"use client";

/**
 * 工程一覧（このアプリのいちばん大事な画面）。
 * 1行＝品目1つ。右に工程を順番どおり全部「札」で並べ、どこまで進んだかを一目で見せる。
 *   完了＝緑地「済」／作業中＝黄地「中」／次（最初の未完了でまだ始まっていない）＝青い枠「次」／まだ＝灰
 *   色だけで伝えないよう、札の頭に「済・中・次」の字を付ける（WEBデザインルール）。外注・出荷も字で付ける。
 * 上の「今の工程ごとの数」を押すと、その工程にいる品目だけに絞る（受注がいまどこにいるかの全体像）。
 * 見方は川﨑課長の試作の工程一覧（index.html rowHtml）と同じ。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import { stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ScrollWrap from "@/components/ScrollWrap";

type Status = "open" | "done" | "all";

const PAGE = 200;

async function fetchBoard(): Promise<Board> {
  const r = await fetch("/api/board", { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as Board;
}

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
  const [board, setBoard] = useState<Board | null>(null);
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

  const show = useCallback((p: Promise<Board>) => {
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
          <ItemRowView key={it.id} it={it} today={today} open={open === it.id} onToggle={() => setOpen(open === it.id ? null : it.id)} />
        ))}
      </div>
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="mt-4 min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          さらに{PAGE}件出す（あと{rows.length - limit}件）
        </button>
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

function ItemRowView({ it, today, open, onToggle }: { it: BoardItem; today: string; open: boolean; onToggle: () => void }) {
  const cur = curOf(it);
  const done = isDone(it);
  const late = !!it.final_due && dateOnly(it.final_due) < today && !done;
  // 出荷の工程（名前に「出荷」が無いときは最後の工程＝「目視、梱包」など。在庫の計算と同じ決め方）
  const shipId = stockRole(it.kubun, it.procs)?.ship ?? "";
  return (
    <div className={`rounded-lg border bg-white ${late ? "border-l-8 border-l-danger border-line" : "border-line"}`}>
      <div className="flex flex-col gap-2 p-2 lg:flex-row">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-col items-start gap-1 text-left lg:w-80 lg:shrink-0" aria-expanded={open}>
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
                <span className={`${CHIP} ${CHIP_STYLE[st]}`} title={tip}>
                  <span>
                    {MARK[st] && <span className="mr-1">{MARK[st]}</span>}
                    {p.in_out === "外注" && <span className="mr-1 text-sm">外注</span>}
                    {p.name}
                    {ship && <span className="ml-1 text-sm">出荷</span>}
                  </span>
                  {sub && <span className="text-sm font-normal text-ink-sub">{sub}</span>}
                  {p.working.length > 0 && <span className="text-sm font-bold">作業中{p.working.length}人</span>}
                </span>
              </span>
            );
          })}
        </div>
      </div>
      {open && <ItemDetail it={it} />}
    </div>
  );
}

function ItemDetail({ it }: { it: BoardItem }) {
  return (
    <div className="border-t border-line p-4">
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
