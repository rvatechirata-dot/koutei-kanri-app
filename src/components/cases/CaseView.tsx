"use client";

/**
 * 案件の画面（4段目・管理者だけ）。案件の登録・修正、品目と工程の並びの編集、ごみ箱へ・ごみ箱から戻す。
 * 直している途中の中身は画面の中だけに持ち、「保存する」で1回にまとめて送る（試作と同じ）。
 * ⚠ エムネットから来た品目を画面で直しても、次のCSV取り込みでエムネットの中身に戻る。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CaseDoc, CaseEdit, ItemEdit, ProcEdit } from "@/lib/kotei/edit";
import type { MasterList } from "@/lib/kotei/masters";

interface CaseLite {
  id: string;
  mgmt_no: string;
  customer: string;
  customer_po: string;
  items: number;
  due: string;
  drawings: string;
}
interface TrashLite {
  bundle: string;
  kind: string;
  title: string;
  n: number;
  deleted_at: string;
  deleted_by: string;
}
interface DProc {
  id: string;
  isNew: boolean;
  f: ProcEdit;
  state: string; // 済・中（直せない欄の様子を見せるだけ）
}
interface DItem {
  id: string;
  isNew: boolean;
  barcode: string;
  source: string;
  f: ItemEdit;
  procs: DProc[];
}
interface Draft {
  aid: string;
  isNew: boolean;
  base: string;
  a: CaseEdit;
  items: DItem[];
}

const BTN = "min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50";
const MAIN = `${BTN} bg-accent text-white`;
const SUB = `${BTN} border border-accent bg-white text-accent`;
const DANGER = `${BTN} border border-danger bg-white text-danger`;
const INPUT = "min-h-11 w-full rounded border border-ink-sub bg-white px-2 text-base";
const nid = (p: string) => p + "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const EMPTY_A: CaseEdit = { mgmt_no: "", sales_rep: "", customer_po: "", customer: "", customer_contact: "", order_date: "", bulk_due: "", note: "", annotation: "", hidden: "" };
const EMPTY_I: ItemEdit = { kubun: "", kubun2: "", ext_barcode: "", drawing_no: "", name: "", unit_price: "", qty: "", final_due: "", knowhow: "", note: "", hidden: "" };
const EMPTY_P: ProcEdit = { in_out: "社内", name: "", assignee: "", machine: "", plan_start: "", due: "", unit_price: "", std_time: "", note: "" };

function toDraft(doc: CaseDoc): Draft {
  const a = Object.fromEntries(Object.keys(EMPTY_A).map((k) => [k, (doc.case as unknown as Record<string, string>)[k] ?? ""])) as unknown as CaseEdit;
  return {
    aid: doc.case.id,
    isNew: false,
    base: doc.base,
    a,
    items: doc.items.map((i) => ({
      id: i.id,
      isNew: false,
      barcode: i.barcode,
      source: i.source,
      f: Object.fromEntries(Object.keys(EMPTY_I).map((k) => [k, (i as unknown as Record<string, string>)[k] ?? ""])) as unknown as ItemEdit,
      procs: i.procs.map((p) => ({
        id: p.id,
        isNew: false,
        state: p.done_at ? "済" : p.started_at ? "中" : "",
        f: Object.fromEntries(Object.keys(EMPTY_P).map((k) => [k, (p as unknown as Record<string, string>)[k] ?? ""])) as unknown as ProcEdit,
      })),
    })),
  };
}

export default function CaseView() {
  const params = useSearchParams();
  const [list, setList] = useState<CaseLite[] | null>(null);
  const [trash, setTrash] = useState<TrashLite[]>([]);
  const [names, setNames] = useState<Record<string, string[]>>({});
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const loadAll = useCallback(
    () =>
      Promise.all([
        fetch("/api/cases", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/cases?trash=1", { cache: "no-store" }).then((r) => r.json()),
      ]).then(([l, t]) => {
        setList(l as CaseLite[]);
        setTrash(t as TrashLite[]);
      }),
    []
  );
  const open = useCallback(
    (id: string) =>
      fetch(`/api/cases?id=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if ((j as { error?: string }).error) setMsg({ text: (j as { error: string }).error, bad: true });
          else setDraft(toDraft(j as CaseDoc));
        }),
    []
  );
  useEffect(() => {
    loadAll();
    fetch("/api/masters", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const m = j as MasterList;
        const o: Record<string, string[]> = {};
        m.rows.filter((r) => r.unused !== "1").forEach((r) => (o[r.kind] ||= []).push(r.name));
        Object.entries(m.used).forEach(([k, u]) => Object.keys(u).forEach((n) => !(o[k] ||= []).includes(n) && o[k].push(n)));
        setNames(o);
      })
      .catch(() => {});
    const id = params.get("id");
    if (id) open(id);
  }, [loadAll, open, params]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (list ?? []).filter((c) => !k || [c.mgmt_no, c.customer, c.customer_po, c.drawings].join(" ").toLowerCase().includes(k)).slice(0, 100);
  }, [list, q]);

  const upd = (f: (d: Draft) => Draft) => setDraft((d) => (d ? f(structuredClone(d)) : d));

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "save",
          aid: draft.aid,
          isNew: draft.isNew,
          base: draft.base,
          a: draft.a,
          items: draft.items.map((i) => ({ id: i.id, isNew: i.isNew, f: i.f, procs: i.procs.map((p) => ({ id: p.id, isNew: p.isNew, f: p.f })) })),
        }),
      });
      const j = (await r.json()) as { error?: string; newBarcodes?: string[] };
      if (!r.ok) return setMsg({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）", bad: true });
      setMsg({ text: `保存しました。${j.newBarcodes?.length ? `新しいバーコード番号：${j.newBarcodes.join("・")}` : ""}` });
      await open(draft.aid);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const toTrash = async () => {
    if (!draft || draft.isNew) return;
    if (!confirm(`案件「${draft.a.mgmt_no}」を、品目・工程と一緒にごみ箱へ入れます。よろしいですか？（ごみ箱から戻せます）`)) return;
    setBusy(true);
    const r = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "trash", aid: draft.aid, base: draft.base }) });
    const j = (await r.json()) as { error?: string };
    setBusy(false);
    if (!r.ok) return setMsg({ text: j.error || "ごみ箱へ入れられませんでした", bad: true });
    setMsg({ text: "ごみ箱へ入れました。" });
    setDraft(null);
    loadAll();
  };
  const restore = async (t: TrashLite) => {
    if (!confirm(`「${t.title}」（${t.n}件）をごみ箱から戻します。よろしいですか？`)) return;
    const r = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "restore", bundle: t.bundle }) });
    const j = (await r.json()) as { error?: string };
    setMsg(r.ok ? { text: "戻しました。" } : { text: j.error || "戻せませんでした", bad: true });
    loadAll();
  };

  const copyLast = async (k: number) => {
    const it = draft!.items[k];
    if (!it.f.drawing_no) return alert("先に図面番号を入れてください");
    const r = await fetch(`/api/cases?template=${encodeURIComponent(it.f.drawing_no)}&except=${encodeURIComponent(it.id)}`, { cache: "no-store" });
    const ps = (await r.json()) as ProcEdit[];
    if (!ps.length) return alert(`図面番号「${it.f.drawing_no}」の前の品目が見つかりません`);
    if (it.procs.length && !confirm(`今の工程（${it.procs.length}個）を、前回の並び（${ps.length}個）に置き換えます。よろしいですか？`)) return;
    upd((d) => {
      d.items[k].procs = ps.map((f) => ({ id: nid("P"), isNew: true, state: "", f }));
      return d;
    });
  };

  if (!list) return <p className="py-8 text-base text-ink-sub">{msg?.text || "読み込み中…"}</p>;

  return (
    <div>
      <datalist id="dl-proc">{(names["工程名"] ?? []).map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="dl-mc">{(names["機械"] ?? []).map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="dl-who">{[...(names["作業者"] ?? []), ...(names["外注先"] ?? [])].map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="dl-cust">{(names["顧客"] ?? []).map((n) => <option key={n} value={n} />)}</datalist>
      <h1 className="text-2xl font-bold">案件</h1>
      <p className="mt-2 text-sm text-ink-sub">
        案件・品目・工程の並びを登録・修正します。エムネットから来た品目を直しても、次のCSV取り込みでエムネットの中身に戻ります（「変わる」に出ます）。開始・完了の日時や完成数量は、ここでは変わりません。
      </p>
      {msg && (
        <p role="status" className={`mt-2 whitespace-pre-wrap rounded border bg-white p-2 text-base ${msg.bad ? "border-danger text-danger" : "border-ok"}`}>
          {msg.text}
        </p>
      )}

      {!draft && (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-2 text-sm">
              さがす（管理番号・顧客・顧客発注番号・図面番号）
              <input value={q} onChange={(e) => setQ(e.target.value)} className={`${INPUT} w-80`} />
            </label>
            <button
              type="button"
              onClick={() => setDraft({ aid: nid("A"), isNew: true, base: "", a: { ...EMPTY_A }, items: [{ id: nid("I"), isNew: true, barcode: "", source: "この画面", f: { ...EMPTY_I }, procs: [] }] })}
              className={MAIN}
            >
              新しい案件
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-base">
              <thead className="bg-card">
                <tr>
                  {["社内管理番号", "顧客", "顧客発注番号", "品目", "いちばん早い納期", "図面番号"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="border-b border-line">
                    <td className="px-2 py-1">
                      <button type="button" onClick={() => open(c.id)} className="min-h-11 text-left font-bold text-accent underline">
                        {c.mgmt_no || "（管理番号なし）"}
                      </button>
                    </td>
                    <td className="px-2 py-1">{c.customer}</td>
                    <td className="px-2 py-1">{c.customer_po}</td>
                    <td className="px-2 py-1 text-right">{c.items}</td>
                    <td className="whitespace-nowrap px-2 py-1">{c.due}</td>
                    <td className="px-2 py-1">{c.drawings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(list?.length ?? 0) > shown.length && <p className="mt-2 text-sm text-ink-sub">100件まで出しています。さがす欄で絞ってください。</p>}
          </div>

          <section className="mt-8">
            <h2 className="text-xl font-bold">ごみ箱（{trash.length}）</h2>
            {trash.length === 0 ? (
              <p className="mt-2 text-base text-ink-sub">ありません。</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {trash.map((t) => (
                  <div key={t.bundle} className="flex flex-wrap items-center gap-4 rounded border border-line p-2 text-base">
                    <span>
                      {t.deleted_at}　{t.kind}　<b>{t.title}</b>
                      {t.n > 1 && `（ほか${t.n - 1}件）`}　{t.deleted_by}
                    </span>
                    <button type="button" onClick={() => restore(t)} className={`${SUB} ml-auto`}>
                      戻す
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {draft && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="text-xl font-bold">{draft.isNew ? "新しい案件" : `案件 ${draft.a.mgmt_no}`}</h2>
            <button type="button" onClick={() => confirm("直した中身を保存せずに一覧へ戻ります。よろしいですか？") && setDraft(null)} className={`${SUB} ml-auto`}>
              一覧へ戻る
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-4 rounded-lg bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["mgmt_no", "社内管理番号（必ず）"],
                ["customer", "顧客"],
                ["customer_po", "顧客発注番号"],
                ["customer_contact", "顧客の担当者"],
                ["sales_rep", "営業担当"],
                ["order_date", "受注日（2026/11/04）"],
                ["bulk_due", "一括納期"],
                ["note", "備考"],
                ["annotation", "注釈"],
              ] as [keyof CaseEdit, string][]
            ).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-2 text-sm">
                {label}
                <input
                  value={draft.a[k]}
                  list={k === "customer" ? "dl-cust" : k === "sales_rep" ? "dl-who" : undefined}
                  onChange={(e) => upd((d) => ((d.a[k] = e.target.value), d))}
                  className={INPUT}
                />
              </label>
            ))}
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input type="checkbox" checked={draft.a.hidden === "1"} onChange={(e) => upd((d) => ((d.a.hidden = e.target.checked ? "1" : ""), d))} className="h-5 w-5" />
              工程一覧で隠す
            </label>
          </div>

          {draft.items.map((it, k) => (
            <section key={it.id} className="mt-4 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center gap-4">
                <h3 className="text-xl font-bold">品目{k + 1}</h3>
                <span className="text-sm text-ink-sub">
                  バーコード {it.barcode || "（保存のときに付きます）"}
                  {it.source === "" && !it.isNew && "・エムネットから"}
                </span>
                <button
                  type="button"
                  onClick={() => confirm(`品目${k + 1}を消します（保存したときに、ごみ箱へ入ります）。よろしいですか？`) && upd((d) => (d.items.splice(k, 1), d))}
                  className={`${DANGER} ml-auto`}
                >
                  品目を消す
                </button>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["drawing_no", "図面番号"],
                    ["name", "品名"],
                    ["qty", "数量"],
                    ["final_due", "最終納期"],
                    ["kubun", "区分"],
                    ["kubun2", "区分2"],
                    ["unit_price", "単価"],
                    ["ext_barcode", "社外バーコード"],
                    ["knowhow", "ノウハウ"],
                    ["note", "備考"],
                  ] as [keyof ItemEdit, string][]
                ).map(([f, label]) => (
                  <label key={f} className="flex flex-col gap-2 text-sm">
                    {label}
                    <input value={it.f[f]} onChange={(e) => upd((d) => ((d.items[k].f[f] = e.target.value), d))} className={INPUT} />
                  </label>
                ))}
                <label className="flex min-h-11 items-center gap-2 text-base">
                  <input type="checkbox" checked={it.f.hidden === "1"} onChange={(e) => upd((d) => ((d.items[k].f.hidden = e.target.checked ? "1" : ""), d))} className="h-5 w-5" />
                  隠す
                </label>
              </div>
              <h4 className="mt-4 text-base font-bold">工程（上から順番）</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="no-stripe text-base">
                  <thead className="bg-card">
                    <tr>
                      {["順", "", "社内外注", "工程名", "担当者・外注先", "機械", "開始予定", "納期", "工程単価", "基準時間（分）", "備考", ""].map((h, i) => (
                        <th key={i} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {it.procs.map((p, n) => {
                      const set = (f: keyof ProcEdit, v: string) => upd((d) => ((d.items[k].procs[n].f[f] = v), d));
                      const move = (to: number) =>
                        upd((d) => {
                          const l = d.items[k].procs;
                          const [x] = l.splice(n, 1);
                          l.splice(to, 0, x);
                          return d;
                        });
                      return (
                        <tr key={p.id} className="border-b border-line">
                          <td className="px-2 py-1 text-right">{n + 1}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-sm">{p.state && <span className="rounded border border-line px-1">{p.state}</span>}</td>
                          <td className="px-2 py-1">
                            <select value={p.f.in_out} onChange={(e) => set("in_out", e.target.value)} className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base">
                              <option>社内</option>
                              <option>外注</option>
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.name} list="dl-proc" onChange={(e) => set("name", e.target.value)} className={`${INPUT} min-w-36`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.assignee} list="dl-who" onChange={(e) => set("assignee", e.target.value)} className={`${INPUT} min-w-32`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.machine} list="dl-mc" onChange={(e) => set("machine", e.target.value)} className={`${INPUT} min-w-24`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.plan_start} onChange={(e) => set("plan_start", e.target.value)} placeholder="2026/11/10" className={`${INPUT} min-w-36`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.due} onChange={(e) => set("due", e.target.value)} placeholder="2026/11/12" className={`${INPUT} min-w-36`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.unit_price} onChange={(e) => set("unit_price", e.target.value)} inputMode="decimal" className={`${INPUT} min-w-20 text-right`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.std_time} onChange={(e) => set("std_time", e.target.value)} inputMode="decimal" className={`${INPUT} min-w-20 text-right`} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={p.f.note} onChange={(e) => set("note", e.target.value)} className={`${INPUT} min-w-32`} />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            <button type="button" disabled={n === 0} onClick={() => move(n - 1)} className={`${SUB} px-2`} aria-label="上へ">
                              ↑
                            </button>
                            <button type="button" disabled={n === it.procs.length - 1} onClick={() => move(n + 1)} className={`${SUB} ml-2 px-2`} aria-label="下へ">
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                (!p.state || confirm(`「${p.f.name}」には開始・完了の記録があります。消すと記録も消えます。よろしいですか？`)) && upd((d) => (d.items[k].procs.splice(n, 1), d))
                              }
                              className={`${DANGER} ml-2 px-2`}
                              aria-label="この工程を消す"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => upd((d) => (d.items[k].procs.push({ id: nid("P"), isNew: true, state: "", f: { ...EMPTY_P } }), d))} className={SUB}>
                  工程を足す
                </button>
                <button type="button" onClick={() => copyLast(k)} className={SUB}>
                  前回の並びを写す（同じ図面番号）
                </button>
              </div>
            </section>
          ))}

          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-4 border-t border-line bg-white py-4">
            <button type="button" disabled={busy} onClick={save} className={`${MAIN} px-8`}>
              保存する
            </button>
            <button type="button" onClick={() => upd((d) => (d.items.push({ id: nid("I"), isNew: true, barcode: "", source: "この画面", f: { ...EMPTY_I }, procs: [] }), d))} className={SUB}>
              品目を足す
            </button>
            {!draft.isNew && (
              <button type="button" disabled={busy} onClick={toTrash} className={`${DANGER} ml-auto`}>
                案件をごみ箱へ
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
