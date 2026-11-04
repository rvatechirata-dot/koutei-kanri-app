"use client";

/**
 * 受注一覧（全員見られる）。1行＝品目1つ（エムネットの案件一覧の1行＝受注の1明細）。
 * 向け先・受注日・希望納期・確定納期・今のステータスを一覧にし、見出しを押して並べ替え、上の欄で絞り込む。
 *   希望納期＝品目の最終納期（エムネットの納期）／確定納期＝出荷の工程の納期（ガント・案件の画面で入れた出荷の予定日）
 *   ステータス＝完了（出荷済み）／一部出荷／加工中（今の工程）／未着手。出荷されたら、ほかの工程が残っていても完了（2026-11-04 平田さん）
 * オービックの受発注システムの受注データを取り込めるようになったら、受注番号・受注日・回答納期はそちらを正にする予定。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Board, BoardItem } from "@/lib/kotei/board";
import { isItemDone, stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ScrollWrap from "@/components/ScrollWrap";

type Status = "未着手" | "加工中" | "一部出荷" | "完了";
const STATUSES: Status[] = ["未着手", "加工中", "一部出荷", "完了"];

interface Row {
  it: BoardItem;
  customer: string;
  order: string; // 受注日
  wish: string; // 希望納期
  fixed: string; // 確定納期
  status: Status;
  cur: string; // 今の工程
  shipped: number;
  shipDone: string; // 出荷した日（完了のとき）
  late: boolean;
}

type Key = "mgmt" | "customer" | "item" | "qty" | "order" | "wish" | "fixed" | "status" | "cur";
const COLS: [Key, string][] = [
  ["mgmt", "社内管理番号"],
  ["customer", "向け先"],
  ["item", "図面番号・品名"],
  ["qty", "数量"],
  ["order", "受注日"],
  ["wish", "希望納期"],
  ["fixed", "確定納期"],
  ["status", "ステータス"],
  ["cur", "今の工程"],
];

const d10 = (s: string) => (s || "").slice(0, 10);

function toRow(it: BoardItem, today: string): Row {
  const role = stockRole(it.kubun, it.procs);
  const ship = role ? it.procs.find((p) => p.id === role.ship) : undefined;
  const done = isItemDone(it.kubun, it.procs);
  const shipped = ship?.shipped ?? 0;
  const started = it.procs.some((p) => p.started_at || p.done_at);
  const status: Status = done ? "完了" : shipped > 0 ? "一部出荷" : started ? "加工中" : "未着手";
  const cur = done ? "" : (it.procs.find((p) => !p.done_at)?.name ?? "");
  const fixed = d10(ship?.due || "");
  const wish = d10(it.final_due);
  const limit = fixed || wish;
  return {
    it,
    customer: it.customer,
    order: d10(it.order_date),
    wish,
    fixed,
    status,
    cur,
    shipped,
    shipDone: done ? d10(ship?.done_at || it.procs.map((p) => p.done_at).sort().pop() || "") : "",
    late: !done && !!limit && limit < today,
  };
}

const sortVal = (r: Row, k: Key): string | number => {
  switch (k) {
    case "mgmt":
      return r.it.mgmt_no;
    case "customer":
      return r.customer;
    case "item":
      return `${r.it.drawing_no} ${r.it.name}`;
    case "qty":
      return Number(r.it.qty) || 0;
    case "order":
      return r.order || "9999";
    case "wish":
      return r.wish || "9999";
    case "fixed":
      return r.fixed || "9999";
    case "status":
      return STATUSES.indexOf(r.status);
    case "cur":
      return r.cur;
  }
};

interface Filters {
  q: string;
  customer: string;
  status: Status[];
  orderFrom: string;
  orderTo: string;
  dueFrom: string;
  dueTo: string;
  late: boolean;
  hidden: boolean;
}
const EMPTY: Filters = { q: "", customer: "", status: ["未着手", "加工中", "一部出荷"], orderFrom: "", orderTo: "", dueFrom: "", dueTo: "", late: false, hidden: false };
const KEY = "koutei:orders";

export default function OrdersView() {
  const today = todayJst();
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [f, setFState] = useState<Filters>(() => {
    try {
      return typeof window === "undefined" ? EMPTY : { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}").f };
    } catch {
      return EMPTY;
    }
  });
  const [sort, setSortState] = useState<{ k: Key; asc: boolean }>(() => {
    try {
      return (typeof window !== "undefined" && JSON.parse(localStorage.getItem(KEY) || "{}").sort) || { k: "wish", asc: true };
    } catch {
      return { k: "wish", asc: true };
    }
  });
  const save = (nf: Filters, ns: typeof sort) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ f: nf, sort: ns }));
    } catch {
      // 覚えられなくても動く
    }
  };
  const setF = (p: Partial<Filters>) => {
    const n = { ...f, ...p };
    setFState(n);
    save(n, sort);
  };
  const setSort = (k: Key) => {
    const n = { k, asc: sort.k === k ? !sort.asc : true };
    setSortState(n);
    save(f, n);
  };

  const show = useCallback(
    (p: Promise<Response>) =>
      p
        .then((r) => r.json())
        .then((j) => setBoard(j as Board))
        .catch(() => setErr("読み込めませんでした。")),
    []
  );
  useEffect(() => {
    show(fetch("/api/board", { cache: "no-store" }));
  }, [show]);

  const all = useMemo(() => (board ? board.items.map((it) => toRow(it, today)) : []), [board, today]);
  const customers = useMemo(() => [...new Set(all.map((r) => r.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")), [all]);
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const l = all.filter((r) => {
      if (!f.hidden && (r.it.hidden === "1" || r.it.case_hidden === "1")) return false;
      if (f.customer && r.customer !== f.customer) return false;
      if (f.status.length && !f.status.includes(r.status)) return false;
      if (f.late && !r.late) return false;
      if (f.orderFrom && (!r.order || r.order < f.orderFrom)) return false;
      if (f.orderTo && (!r.order || r.order > f.orderTo)) return false;
      const due = r.fixed || r.wish;
      if (f.dueFrom && (!due || due < f.dueFrom)) return false;
      if (f.dueTo && (!due || due > f.dueTo)) return false;
      if (q && ![r.it.mgmt_no, r.customer, r.it.drawing_no, r.it.name, r.it.customer_po, r.it.barcode, r.cur].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sort.asc ? 1 : -1;
    return l.sort((a, b) => {
      const x = sortVal(a, sort.k);
      const y = sortVal(b, sort.k);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ja", { numeric: true });
      return c * dir || a.it.mgmt_no.localeCompare(b.it.mgmt_no, "ja");
    });
  }, [all, f, sort]);

  if (!board) return <p className="py-8 text-base text-ink-sub">{err || "読み込み中…"}</p>;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s && (f.hidden || (r.it.hidden !== "1" && r.it.case_hidden !== "1"))).length]));
  const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
  const dash = (s: string) => s.replace(/\//g, "-");
  const slash = (s: string) => s.replace(/-/g, "/");

  const csv = () => {
    const head = ["社内管理番号", "向け先", "顧客発注番号", "図面番号", "品名", "数量", "受注日", "希望納期", "確定納期", "ステータス", "今の工程", "出荷済み", "出荷日", "遅れ"];
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = rows.map((r) =>
      [r.it.mgmt_no, r.customer, r.it.customer_po, r.it.drawing_no, r.it.name, r.it.qty, r.order, r.wish, r.fixed, r.status, r.cur, String(r.shipped || ""), r.shipDone, r.late ? "遅れ" : ""].map(q).join(",")
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv" }));
    a.download = `受注一覧_${today.replace(/\//g, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">受注一覧</h1>
      <p className="mt-2 text-sm text-ink-sub">
        1行＝品目1つ。希望納期＝品目の最終納期（エムネット）、確定納期＝出荷の工程の納期（ガント・案件の画面で入れた出荷の予定日）。出荷の工程が済んだら「完了」です。見出しを押すと並べ替えます（もう一度押すと逆の順）。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-card p-4">
        <label className="flex flex-col gap-2 text-sm">
          さがす（管理番号・図面番号・品名・顧客発注番号・工程）
          <input value={f.q} onChange={(e) => setF({ q: e.target.value })} className={`${INPUT} w-72 max-w-full`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          向け先
          <select value={f.customer} onChange={(e) => setF({ customer: e.target.value })} className={INPUT}>
            <option value="">すべて</option>
            {customers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-2">ステータス</legend>
          <div className="flex flex-wrap gap-4">
            {STATUSES.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2 text-base">
                <input
                  type="checkbox"
                  checked={f.status.includes(s)}
                  onChange={(e) => setF({ status: e.target.checked ? [...f.status, s] : f.status.filter((x) => x !== s) })}
                  className="h-5 w-5"
                />
                {s}（{counts[s]}）
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-2 text-sm">
          受注日（から）
          <input type="date" value={dash(f.orderFrom)} onChange={(e) => setF({ orderFrom: slash(e.target.value) })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          受注日（まで）
          <input type="date" value={dash(f.orderTo)} onChange={(e) => setF({ orderTo: slash(e.target.value) })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          納期（から）
          <input type="date" value={dash(f.dueFrom)} onChange={(e) => setF({ dueFrom: slash(e.target.value) })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          納期（まで）
          <input type="date" value={dash(f.dueTo)} onChange={(e) => setF({ dueTo: slash(e.target.value) })} className={INPUT} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={f.late} onChange={(e) => setF({ late: e.target.checked })} className="h-5 w-5" />
          遅れだけ
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={f.hidden} onChange={(e) => setF({ hidden: e.target.checked })} className="h-5 w-5" />
          隠したものも出す
        </label>
        <button type="button" onClick={() => setF(EMPTY)} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          条件を消す
        </button>
        <button type="button" onClick={csv} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          CSVで保存
        </button>
      </div>
      <p className="mt-2 text-base">{rows.length}件（納期の絞り込みは、確定納期があればそれ、無ければ希望納期で見ます）</p>

      <ScrollWrap className="mt-2">
        <table className="w-full text-base">
          <thead className="bg-card">
            <tr>
              {COLS.map(([k, label]) => (
                <th key={k} className="whitespace-nowrap border-b border-line p-0 text-left font-bold" aria-sort={sort.k === k ? (sort.asc ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => setSort(k)} className="flex min-h-11 w-full items-center gap-1 px-2 text-left font-bold">
                    {label}
                    <span className={sort.k === k ? "text-accent" : "text-ink-sub"}>{sort.k === k ? (sort.asc ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-2 py-2 text-ink-sub">
                  当てはまる受注がありません。
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.it.id} className="border-b border-line">
                <td className="whitespace-nowrap px-2 py-1 font-bold">
                  <Link href={`/board?q=${encodeURIComponent(r.it.mgmt_no)}`} className="text-accent underline">
                    {r.it.mgmt_no}
                  </Link>
                </td>
                <td className="px-2 py-1">{r.customer}</td>
                <td className="px-2 py-1">
                  {r.it.drawing_no} {r.it.name}
                </td>
                <td className="px-2 py-1 text-right">{r.it.qty}</td>
                <td className="whitespace-nowrap px-2 py-1">{r.order}</td>
                <td className={`whitespace-nowrap px-2 py-1 ${r.late && !r.fixed ? "font-bold text-danger" : ""}`}>{r.wish}</td>
                <td className={`whitespace-nowrap px-2 py-1 ${r.late && r.fixed ? "font-bold text-danger" : ""}`}>{r.fixed || "－"}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  <StatusTag s={r.status} />
                  {r.status === "一部出荷" && <span className="ml-1 text-sm">{r.shipped}個</span>}
                  {r.status === "完了" && r.shipDone && <span className="ml-1 text-sm text-ink-sub">{r.shipDone}</span>}
                  {r.late && <span className="ml-1 rounded border border-danger px-1 text-sm font-bold text-danger">遅れ</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">{r.cur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollWrap>
    </div>
  );
}

function StatusTag({ s }: { s: Status }) {
  const cls =
    s === "完了" ? "border-ok bg-[#E6F2EC]" : s === "一部出荷" ? "border-accent bg-white" : s === "加工中" ? "border-[#B08A00] bg-warn-bg" : "border-line bg-card";
  return <span className={`rounded border px-2 text-sm font-bold ${cls}`}>{s}</span>;
}
