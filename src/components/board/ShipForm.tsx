"use client";

/**
 * 出荷を記録する欄（工程の小窓と「出荷」の画面で同じものを使う・3段目）。
 * 「これで全部」あり → 出荷の工程を完了にする（完成数量＝出荷した数の合計）。なし → 分納（工程は作業中のまま。何回でも記録できる）。
 * 試作と同じく、数が残りより少ないのに「これで全部」・残りに届いたのに「これで全部」が無い、のときは確かめる。
 */
import { useState } from "react";
import type { Act, ShipInput } from "@/lib/kotei/acts";
import { todayJst } from "@/lib/kotei/time";

const CARRIERS = ["ヤマト運輸", "佐川急便", "西濃運輸", "福山通運", "日本郵便", "自社便", "持参"];
const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export default function ShipForm({
  pid,
  name,
  qty,
  shipped,
  worker,
  busy,
  run,
}: {
  pid: string;
  name: string; // 出荷の工程の名前
  qty: number; // 品目の数量
  shipped: number; // これまでに出荷した数
  worker: string;
  busy: boolean;
  run: (acts: Act[], msg: string) => Promise<boolean>;
}) {
  const left = Math.max(0, qty - shipped);
  const [n, setN] = useState(fmt(left));
  const [all, setAll] = useState(true);
  const [f, setF] = useState<ShipInput>({ ship_date: todayJst(), carrier: "", slip_no: "", packages: "", time_spec: "", dest: "", contact: "", note: "", from_stock: "" });
  const set = (k: keyof ShipInput, v: string) => setF({ ...f, [k]: v });

  const submit = async () => {
    const q = Number(n);
    if (!/^\d+(\.\d+)?$/.test(n.trim())) {
      alert("出荷する数を数字で入れてください");
      return;
    }
    if (!all && !(q > 0)) {
      alert("分けて出すときは、出荷する数を1以上にしてください");
      return;
    }
    if (all && q + shipped < qty && !confirm(`出荷した数の合計（${fmt(q + shipped)}）が数量（${fmt(qty)}）に届いていませんが、「これで全部」にして${name}を完了にします。よろしいですか？`)) return;
    if (!all && q + shipped >= qty && !confirm(`出荷した数の合計が数量（${fmt(qty)}）に届きます。「これで全部」を付けずに、${name}を作業中のままにしますか？`)) return;
    const ship = { ...f, contact: f.contact || worker };
    const ok = await run(
      all ? [{ op: "done", pid, qty: n.trim(), ship }] : [{ op: "ship", pid, qty: n.trim(), ship }],
      all ? `出荷を記録して${name}を完了にしました` : "出荷（分納）を記録しました"
    );
    if (ok) setN(fmt(Math.max(0, left - q)));
  };

  return (
    <div className="rounded-lg bg-card p-4">
      <p className="text-base">
        数量 <b>{fmt(qty)}</b>・出荷済み <b>{fmt(shipped)}</b>・残り <b>{fmt(left)}</b>
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          出荷日
          <input value={f.ship_date} onChange={(e) => set("ship_date", e.target.value)} className={`${INPUT} w-36`} placeholder="2026/11/04" />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          出荷する数
          <input value={n} onChange={(e) => setN(e.target.value)} inputMode="decimal" className={`${INPUT} w-28 text-right`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          配送業者
          <select value={f.carrier} onChange={(e) => set("carrier", e.target.value)} className={INPUT}>
            <option value="">（選ぶ）</option>
            {CARRIERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          伝票番号
          <input value={f.slip_no} onChange={(e) => set("slip_no", e.target.value)} className={`${INPUT} w-40`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          荷物の個数
          <input value={f.packages} onChange={(e) => set("packages", e.target.value)} inputMode="numeric" className={`${INPUT} w-24 text-right`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          時間指定
          <input value={f.time_spec} onChange={(e) => set("time_spec", e.target.value)} className={`${INPUT} w-32`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          お届け先
          <input value={f.dest} onChange={(e) => set("dest", e.target.value)} className={`${INPUT} w-56`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          担当者
          <input value={f.contact} onChange={(e) => set("contact", e.target.value)} className={`${INPUT} w-36`} placeholder={worker} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          備考
          <input value={f.note} onChange={(e) => set("note", e.target.value)} className={`${INPUT} w-56`} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-5 w-5" />
          これで全部（{name}を完了にする）
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={f.from_stock === "1"} onChange={(e) => set("from_stock", e.target.checked ? "1" : "")} className="h-5 w-5" />
          作り置きの在庫から出した
        </label>
        <button type="button" disabled={busy} onClick={submit} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white disabled:opacity-50">
          出荷を記録
        </button>
      </div>
      {!all && <p className="mt-2 text-sm text-ink-sub">分けて出す（分納）ときは「これで全部」を外します。工程は作業中のままで、何回でも記録できます。</p>}
    </div>
  );
}
