"use client";

/**
 * 工程一覧の画面のまま、青い帯に出ている項目を直す（2026-11-28 川﨑部長）。
 * 直せるもの：管理番号・客先（案件の欄）／区分・図面番号・品名・数量・最終納期・ノウハウ・備考（この品目の欄）。
 * 工程の並びやほかの品目は変えない（「別画面で」の案件を直す画面で行う）。
 * 保存は案件を直す画面と同じ /api/cases（kind: save）。ほかの品目・工程は今の値のまま送る。
 * ⚠ エムネットから来た品目は、次のCSV取り込みでエムネットの中身に戻る（案件を直す画面と同じ）。
 */
import { useEffect, useState } from "react";
import type { BoardItem } from "@/lib/kotei/board";

type Row = Record<string, string>;
interface Doc {
  case: Row;
  items: (Row & { procs: Row[] })[];
  base: string;
}

const EDIT_A = ["mgmt_no", "sales_rep", "customer_po", "customer", "customer_contact", "order_date", "bulk_due", "note", "annotation", "hidden"];
const EDIT_I = ["kubun", "kubun2", "ext_barcode", "drawing_no", "name", "unit_price", "qty", "final_due", "knowhow", "note", "hidden"];
const EDIT_P = ["in_out", "name", "assignee", "machine", "plan_start", "due", "unit_price", "std_time", "note"];
const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? ""]));

interface Form {
  mgmt_no: string;
  customer: string;
  kubun: string;
  drawing_no: string;
  name: string;
  qty: string;
  due: string; // YYYY-MM-DD（入力欄の形）
  knowhow: string;
  note: string;
}

const INPUT = "min-h-11 w-full rounded border border-ink-sub bg-white px-2 text-base";

export default function CaseQuickEdit({ it, onClose, onSaved }: { it: BoardItem; onClose: () => void; onSaved: (msg: string) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/cases?id=${encodeURIComponent(it.case_id)}`, { cache: "no-store" });
        const j = (await r.json()) as Doc & { error?: string };
        if (!alive) return;
        if (!r.ok) return setErr(j.error || `読み込めませんでした（${r.status}）`);
        const me = j.items.find((x) => x.id === it.id);
        if (!me) return setErr("この品目が見つかりません（取り込みで消えたかもしれません）。画面を最新にしてください。");
        setDoc(j);
        setF({
          mgmt_no: j.case.mgmt_no ?? "",
          customer: j.case.customer ?? "",
          kubun: me.kubun ?? "",
          drawing_no: me.drawing_no ?? "",
          name: me.name ?? "",
          qty: me.qty ?? "",
          due: (me.final_due ?? "").slice(0, 10).replace(/\//g, "-"),
          knowhow: me.knowhow ?? "",
          note: me.note ?? "",
        });
      } catch {
        if (alive) setErr("読み込めませんでした。通信を確かめてください。");
      }
    })();
    return () => {
      alive = false;
    };
  }, [it.case_id, it.id]);

  const save = async () => {
    if (!doc || !f) return;
    setBusy(true);
    setErr("");
    const me = doc.items.find((x) => x.id === it.id)!;
    // 最終納期：日付を変えていなければ、元の値（時刻つきも）のまま
    const oldDue = me.final_due ?? "";
    const newDue = f.due.replace(/-/g, "/");
    const finalDue = newDue === oldDue.slice(0, 10) ? oldDue : newDue;
    const a = { ...pick(doc.case, EDIT_A), mgmt_no: f.mgmt_no, customer: f.customer };
    const items = doc.items.map((x) => {
      const base = pick(x, EDIT_I);
      const fi =
        x.id === it.id
          ? { ...base, kubun: f.kubun, drawing_no: f.drawing_no, name: f.name, qty: f.qty.trim(), final_due: finalDue, knowhow: f.knowhow, note: f.note }
          : base;
      return { id: x.id, isNew: false, f: fi, procs: x.procs.map((p) => ({ id: p.id, isNew: false, f: pick(p, EDIT_P) })) };
    });
    try {
      const r = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "save", aid: doc.case.id, isNew: false, base: doc.base, a, items }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr((j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）");
        setBusy(false);
        return;
      }
      onSaved(`${f.mgmt_no} を直しました。`);
    } catch {
      setErr("保存できませんでした。通信を確かめてください（何も保存されていません）。");
      setBusy(false);
    }
  };

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f && setF({ ...f, [k]: e.target.value });

  return (
    <div className="mb-4 rounded-lg border-2 border-accent bg-white p-4">
      <h3 className="text-lg font-bold">ここで直す（帯に出ている項目）</h3>
      {it.source !== "この画面" && (
        <p className="mt-2 rounded border border-[#B08A00] bg-warn-bg p-2 text-base">
          ⚠ エムネットから取り込んだ案件です。ここで直しても、次のCSV取り込みでエムネットの中身に戻ります。ずっと残したいときは、エムネットの方も直してください。
        </p>
      )}
      {!f && !err && <p className="mt-2 text-base text-ink-sub">読み込み中…</p>}
      {f && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            社内管理番号（案件）
            <input value={f.mgmt_no} onChange={set("mgmt_no")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            客先（案件）
            <input value={f.customer} onChange={set("customer")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            区分
            <input value={f.kubun} onChange={set("kubun")} className={INPUT} placeholder="例：量産品" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            最終納期
            <input type="date" value={f.due} onChange={set("due")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            図面番号
            <input value={f.drawing_no} onChange={set("drawing_no")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            品名
            <input value={f.name} onChange={set("name")} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            数量
            <input value={f.qty} onChange={set("qty")} inputMode="decimal" className={INPUT} />
          </label>
          <span />
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            ノウハウ（帯の右端に出る欄）
            <textarea value={f.knowhow} onChange={set("knowhow")} rows={4} className={`${INPUT} py-1`} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            備考
            <textarea value={f.note} onChange={set("note")} rows={4} className={`${INPUT} py-1`} />
          </label>
        </div>
      )}
      {err && (
        <p role="alert" className="mt-4 whitespace-pre-wrap rounded border border-danger p-2 text-base text-danger">
          ⚠ {err}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={!f || busy} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white disabled:opacity-50">
          {busy ? "保存中…" : "保存する"}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          やめる
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-sub">工程の並び・ほかの品目は変わりません（それは「別画面で直す」で）。</p>
    </div>
  );
}
