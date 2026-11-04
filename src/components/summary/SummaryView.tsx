"use client";

/**
 * 集計の画面（4段目・全員見られる）。作業時間・完成数・不良数を、工程名・図面番号・作業者・機械・不良の理由・顧客・日・月ごとにまとめる。
 * まとめ方・並べ方・10時間の上限は試作（index.html の sumGroups・sumTable・renderSum）と同じ。エクセルで使うときは CSV か コピー。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Fact, Summary } from "@/lib/kotei/summary";
import { todayJst } from "@/lib/kotei/time";
import ScrollWrap from "@/components/ScrollWrap";

const LONG_MIN = 600; // エムネットから写した作業で1回これ（分）をこえるものは、押し忘れとみて時間に入れない（選べる）
const BY = ["工程名", "図面番号", "作業者", "機械", "不良の理由", "顧客", "日", "月"] as const;
type By = (typeof BY)[number];
const SORTS: [string, string][] = [
  ["", "おまかせ"],
  ["min", "作業時間の多い順"],
  ["ng", "不良の多い順"],
  ["rate", "不良率の高い順"],
  ["qty", "完成の多い順"],
  ["name", "名前・日付の順"],
];
const fmtN = (n: number) => String(Math.round(n * 1000) / 1000);
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${Math.round(m % 60)}分` : ""}` : `${Math.round(m)}分`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "");
const topWhy = (o: Record<string, number>) =>
  Object.keys(o)
    .sort((a, b) => o[b] - o[a])
    .slice(0, 3)
    .map((k) => `${k} ${fmtN(o[k])}`)
    .join("・");
const dash = (s: string) => s.replace(/\//g, "-");
const slash = (s: string) => s.replace(/-/g, "/");

interface Group {
  k: string;
  n: number;
  nP: number;
  min: number;
  minQ: number;
  qty: number;
  ng: number;
  open: number;
  why: Record<string, number>;
}

function keyOf(f: Fact, by: By): string {
  if (by === "工程名") return f.proc;
  if (by === "図面番号") return f.dw + (f.item ? " " + f.item : "");
  if (by === "作業者") return f.who || "（作業者なし）";
  if (by === "機械") return f.mc || "（機械なし）";
  if (by === "不良の理由") return f.why;
  if (by === "顧客") return f.customer || "（顧客なし）";
  if (by === "日") return f.day;
  return f.day.slice(0, 7);
}

export default function SummaryView() {
  const today = todayJst();
  const [v, setV] = useState(() => {
    const base = { from: today.slice(0, 8) + "01", to: today, by: "工程名" as By, sort: "", q: "", noW: true, cap: true };
    try {
      const s = typeof window === "undefined" ? {} : JSON.parse(localStorage.getItem("koutei:sum") || "{}");
      return { ...base, by: BY.includes(s.by) ? s.by : base.by, sort: s.sort ?? "", noW: s.noW ?? true, cap: s.cap ?? true };
    } catch {
      return base;
    }
  });
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const set = (p: Partial<typeof v>) => {
    const n = { ...v, ...p };
    setV(n);
    try {
      localStorage.setItem("koutei:sum", JSON.stringify({ by: n.by, sort: n.sort, noW: n.noW, cap: n.cap }));
    } catch {
      // 覚えられなくても動く
    }
  };

  const show = useCallback(
    (p: Promise<Response>) =>
      p
        .then((r) => r.json())
        .then((j) => {
          setData(j as Summary);
          setErr("");
        })
        .catch(() => setErr("読み込めませんでした。")),
    []
  );
  useEffect(() => {
    show(fetch(`/api/summary?from=${encodeURIComponent(v.from)}&to=${encodeURIComponent(v.to)}&noW=${v.noW ? 1 : 0}`, { cache: "no-store" }));
  }, [show, v.from, v.to, v.noW]);

  const capped = useCallback((f: { src: boolean; min: number | null }) => v.cap && f.src && f.min !== null && f.min > LONG_MIN, [v.cap]);

  const facts = useMemo(() => {
    if (!data) return [];
    const q = v.q.trim().toLowerCase();
    return data.facts.filter((f) => !q || [f.mgmt, f.dw, f.item, f.customer, f.proc, f.who, f.mc].join(" ").toLowerCase().includes(q));
  }, [data, v.q]);

  const groups = useMemo(() => {
    const g: Record<string, Group> = {};
    facts.forEach((f) => {
      const k = keyOf(f, v.by);
      if (!k) return; // 不良の理由ごとのときは、不良の無い作業は入れない
      const x = (g[k] ||= { k, n: 0, nP: 0, min: 0, minQ: 0, qty: 0, ng: 0, open: 0, why: {} });
      if (f.w) x.n++;
      else x.nP++;
      if (f.open) x.open++;
      if (f.min !== null && !capped(f)) {
        x.min += f.min;
        x.minQ += f.qty + f.ng;
      }
      x.qty += f.qty;
      x.ng += f.ng;
      if (f.ng) x.why[f.why] = (x.why[f.why] || 0) + f.ng;
    });
    const l = Object.values(g);
    const s = v.sort || (v.by === "不良の理由" ? "ng" : v.by === "日" || v.by === "月" ? "name" : "min");
    const rate = (x: Group) => (x.qty + x.ng ? x.ng / (x.qty + x.ng) : 0);
    l.sort((a, b) =>
      s === "name"
        ? a.k.localeCompare(b.k, "ja", { numeric: true })
        : s === "ng"
          ? b.ng - a.ng || b.min - a.min
          : s === "rate"
            ? rate(b) - rate(a) || b.ng - a.ng
            : s === "qty"
              ? b.qty - a.qty
              : b.min - a.min || b.ng - a.ng
    );
    return l;
  }, [facts, v.by, v.sort, capped]);

  const table = useMemo(() => {
    const isWhy = v.by === "不良の理由";
    const tot = groups.reduce(
      (t, x) => ({ n: t.n + x.n, nP: t.nP + x.nP, min: t.min + x.min, minQ: t.minQ + x.minQ, qty: t.qty + x.qty, ng: t.ng + x.ng }),
      { n: 0, nP: 0, min: 0, minQ: 0, qty: 0, ng: 0 }
    );
    const head = isWhy ? ["不良の理由", "不良数", "割合", "作業", "多い工程"] : [v.by, "作業", "作業時間", "1個あたり", "完成（良品）", "不良", "不良率", "多い不良の理由"];
    const per = (min: number, q: number) => (q && min ? `${Math.round((min / q) * 10) / 10}分` : "");
    const rows = groups.map((x) => {
      if (isWhy) {
        const c: Record<string, number> = {};
        facts.filter((f) => f.ng && f.why === x.k).forEach((f) => (c[f.proc] = (c[f.proc] || 0) + f.ng));
        return [x.k, fmtN(x.ng), pct(x.ng, tot.ng), `${x.n + x.nP}件`, topWhy(c)];
      }
      return [
        x.k,
        `${x.n}件${x.nP ? `＋完了${x.nP}` : ""}${x.open ? `（作業中${x.open}）` : ""}`,
        x.min ? fmtMin(x.min) : "",
        per(x.min, x.minQ),
        fmtN(x.qty),
        x.ng ? fmtN(x.ng) : "",
        pct(x.ng, x.qty + x.ng),
        topWhy(x.why),
      ];
    });
    const totRow = isWhy
      ? ["合計", fmtN(tot.ng), groups.length ? "100%" : "", `${tot.n + tot.nP}件`, ""]
      : ["合計", `${tot.n}件${tot.nP ? `＋完了${tot.nP}` : ""}`, tot.min ? fmtMin(tot.min) : "", per(tot.min, tot.minQ), fmtN(tot.qty), tot.ng ? fmtN(tot.ng) : "", pct(tot.ng, tot.qty + tot.ng), ""];
    return { head, rows, totRow };
  }, [groups, facts, v.by]);

  if (!data) return <p className="py-8 text-base text-ink-sub">{err || "読み込み中…"}</p>;

  const nW = facts.filter((f) => f.w).length;
  const nP = facts.length - nW;
  const nL = facts.filter((f) => capped(f)).length;
  const nLo = facts.filter((f) => !capped(f) && f.min !== null && f.min > LONG_MIN).length;
  const std = data.std
    .map((s) => ({
      ...s,
      min: s.works.reduce((t, w) => t + (w.min !== null && !capped(w) ? w.min : 0), 0),
      open: s.works.some((w) => w.open),
      qty: s.works.reduce((t, w) => t + w.qty, 0),
    }))
    .sort((a, b) => b.min / b.std - a.min / a.std);

  const text = (sep: string) => {
    const q = (s: string) => (sep === "," && /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/[\t\n]/g, " "));
    return [table.head, ...table.rows, ...(table.rows.length ? [table.totRow] : [])].map((r) => r.map(q).join(sep)).join("\r\n");
  };
  const month = (k: number | "7d") => {
    const [y, m, d] = today.split("/").map(Number);
    const f = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, "/");
    if (k === "7d") set({ from: f(new Date(Date.UTC(y, m - 1, d - 6))), to: today });
    else set({ from: f(new Date(Date.UTC(y, m - 1 + k, 1))), to: k ? f(new Date(Date.UTC(y, m - 1, 0))) : today });
  };
  const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
  const SUB = "min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent";

  return (
    <div>
      <h1 className="text-2xl font-bold">集計</h1>
      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-card p-4">
        <label className="flex flex-col gap-2 text-sm">
          期間（から）
          <input type="date" value={dash(v.from)} onChange={(e) => e.target.value && set({ from: slash(e.target.value) })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          期間（まで）
          <input type="date" value={dash(v.to)} onChange={(e) => e.target.value && set({ to: slash(e.target.value) })} className={INPUT} />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => month(0)} className={SUB}>
            今月
          </button>
          <button type="button" onClick={() => month(-1)} className={SUB}>
            先月
          </button>
          <button type="button" onClick={() => month("7d")} className={SUB}>
            7日
          </button>
        </div>
        <label className="flex flex-col gap-2 text-sm">
          まとめ方
          <select value={v.by} onChange={(e) => set({ by: e.target.value as By })} className={INPUT}>
            {BY.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          並べ方
          <select value={v.sort} onChange={(e) => set({ sort: e.target.value })} className={INPUT}>
            {SORTS.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          しぼる（管理番号・図面番号・工程・作業者・機械）
          <input value={v.q} onChange={(e) => set({ q: e.target.value })} className={`${INPUT} w-64`} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={v.cap} onChange={(e) => set({ cap: e.target.checked })} className="h-5 w-5" />
          エムネットから写した作業で、1回10時間をこえるものは時間に入れない
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={v.noW} onChange={(e) => set({ noW: e.target.checked })} className="h-5 w-5" />
          作業を分けずに完了した工程も入れる
        </label>
      </div>
      <p className="mt-4 text-base leading-normal">
        作業 {nW}件{nP ? `・作業を分けずに完了した工程 ${nP}件（時間は無し）` : ""}。作業時間は、作業の開始から終了まで（休み時間も入る）。作業中の作業は時間に入れません。
        {nL > 0 && <b>エムネットから写した作業で1回10時間をこえるもの {nL}件は、時間に入れていません（押し忘れが多いため。数は入れています）。</b>}
        {nLo > 0 && `この画面で記録した作業で1回10時間をこえるもの ${nLo}件は、無人運転などとみて時間に入れています（押し忘れなら、工程の小窓の作業で「直す」から終了の時刻を直してください）。`}
        日付は作業の終了日（作業中は開始日）、工程は完了日で決めます。
      </p>

      <section className="mt-4">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-xl font-bold">
            {v.by}ごと（{groups.length}件）
          </h2>
          <button
            type="button"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob(["﻿" + text(",")], { type: "text/csv" }));
              a.download = `工程管理_集計_${v.by}_${v.from.replace(/\//g, "")}-${v.to.replace(/\//g, "")}.csv`;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                URL.revokeObjectURL(a.href);
                a.remove();
              }, 1000);
            }}
            className={SUB}
          >
            CSVで保存
          </button>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard
                .writeText(text("\t"))
                .then(() => alert("表をコピーしました。エクセルに貼り付けてください"))
                .catch(() => alert("コピーできませんでした。「CSVで保存」を使ってください"))
            }
            className={SUB}
          >
            表をコピー（エクセルに貼れる）
          </button>
        </div>
        <ScrollWrap className="mt-2">
          <table className="w-full text-base">
            <thead className="bg-card">
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={`whitespace-nowrap border-b border-line px-2 py-1 font-bold ${i && i < table.head.length - 1 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={table.head.length} className="px-2 py-2 text-ink-sub">
                    この期間の作業がありません。
                  </td>
                </tr>
              )}
              {table.rows.map((r) => (
                <tr key={r[0]} className="border-b border-line">
                  {r.map((c, i) => (
                    <td key={i} className={`px-2 py-1 ${i && i < r.length - 1 ? "whitespace-nowrap text-right" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              {table.rows.length > 0 && (
                <tr className="border-t-2 border-ink font-bold">
                  {table.totRow.map((c, i) => (
                    <td key={i} className={`px-2 py-1 ${i && i < table.totRow.length - 1 ? "whitespace-nowrap text-right" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </ScrollWrap>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">基準時間との比べ</h2>
        <p className="mt-2 text-sm text-ink-sub">
          基準時間が入っている工程（今は全部で {data.nStd}件）のうち、この期間に作業がある工程。基準時間はエムネットの「基準時間」をその工程全体の分として比べています。作業時間はその工程の作業の合計（期間の外の分も入れる）。
        </p>
        {std.length === 0 ? (
          <p className="mt-2 text-base text-ink-sub">この期間に、基準時間が入っている工程の作業はありません。</p>
        ) : (
          <ScrollWrap className="mt-2">
            <table className="w-full text-base">
              <thead className="bg-card">
                <tr>
                  {["管理番号", "図面番号", "工程", "基準時間", "作業時間", "差", "基準との比", "完成"].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap border-b border-line px-2 py-1 font-bold ${i >= 3 ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {std.map((x) => (
                  <tr key={x.pid} className="border-b border-line">
                    <td className="px-2 py-1">{x.mgmt}</td>
                    <td className="px-2 py-1">{x.dw}</td>
                    <td className="px-2 py-1">
                      {x.proc}
                      {x.open && <span className="ml-2 rounded border border-line px-1 text-sm">作業中あり</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{fmtMin(x.std)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{fmtMin(x.min)}</td>
                    <td className={`whitespace-nowrap px-2 py-1 text-right ${x.min > x.std ? "font-bold text-danger" : ""}`}>
                      {x.min >= x.std ? "＋" : "−"}
                      {fmtMin(Math.abs(x.min - x.std))}
                      {x.min > x.std ? "（超え）" : ""}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{pct(x.min, x.std)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{fmtN(x.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollWrap>
        )}
      </section>
    </div>
  );
}
