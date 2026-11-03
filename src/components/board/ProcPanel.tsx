"use client";

/**
 * 工程の札を押したときに、その品目の下に開く小窓（2段目）。
 * 上の段＝この工程の開始・完了・取り消し。下の段＝工程の中の作業（作業者・機械・完成数・不良数・コメント。何回でも・何人でも）。
 * 作業を終えても工程は自動では完了しない（試作と同じ）。全部終わったら「工程の完了」を押す。
 * 作業者＝ログインした人（共有メールのときだけ、画面の上で選んだ人）。
 */
import { useState } from "react";
import type { BoardItem, BoardProc, BoardWork } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import { stockRole } from "@/lib/kotei/rules";
import ShipForm from "./ShipForm";

export type Send = (acts: Act[], doneMsg: string) => Promise<boolean>;

const BTN = "min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50";
const MAIN = `${BTN} bg-accent text-white`;
const SUB = `${BTN} border border-accent bg-white text-accent`;
const DANGER = `${BTN} border border-danger bg-white text-danger`;
const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";

export default function ProcPanel({
  it,
  p,
  me,
  worker,
  lists,
  send,
  onClose,
}: {
  it: BoardItem;
  p: BoardProc;
  me: { name: string; admin: boolean };
  worker: string;
  lists: { machines: string[]; reasons: string[] };
  send: Send;
  onClose: () => void;
}) {
  const role = stockRole(it.kubun, it.procs);
  const isShip = role?.ship === p.id;
  const done = !!p.done_at;
  const started = !!p.started_at;
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(p.done_qty || it.qty || "");
  const [ng, setNg] = useState(p.defect_qty || "");
  const [why, setWhy] = useState("");
  const [memo, setMemo] = useState(p.comment || "");
  const [mc, setMc] = useState(p.machine || "");

  const run = async (acts: Act[], msg: string) => {
    setBusy(true);
    const ok = await send(acts, msg);
    setBusy(false);
    return ok;
  };
  const doneAct = (): Act => ({
    op: "done",
    pid: p.id,
    qty,
    ng,
    memo,
    why: Number(ng) > 0 ? why : "",
  });

  const live = p.works;
  const mine = (w: BoardWork) => me.admin || w.worker === worker;

  return (
    <div className="border-t-2 border-accent bg-white p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-bold">
            {p.in_out === "外注" && <span className="mr-2 text-base">外注</span>}
            {p.name}
            <span className="ml-2 text-base font-normal">{done ? "（完了）" : started ? "（作業中）" : "（まだ）"}</span>
          </h3>
          <p className="mt-2 text-sm text-ink-sub">
            {[p.assignee && p.assignee !== "-" && `担当 ${p.assignee}`, p.machine && `機械 ${p.machine}`, p.plan_start && `開始予定 ${p.plan_start}`, p.due && `納期 ${p.due}`]
              .filter(Boolean)
              .join("・")}
          </p>
          <p className="mt-1 text-sm text-ink-sub">
            {started && `開始 ${p.started_at}${p.started_by ? `（${p.started_by}）` : ""}`}
            {done && `　完了 ${p.done_at}${p.done_by ? `（${p.done_by}）` : ""}　完成 ${p.done_qty || "－"}${p.defect_qty ? `・不良 ${p.defect_qty}` : ""}`}
          </p>
        </div>
        <button type="button" onClick={onClose} className={`${SUB} ml-auto`}>
          閉じる
        </button>
      </div>

      {/* ── 工程の開始・完了 ── */}
      {!done && isShip && (
        <div className="mt-4">
          <ShipForm pid={p.id} name={p.name} qty={Number(it.qty) || 0} shipped={p.shipped} worker={worker} busy={busy} run={run} />
          <ShipList p={p} busy={busy} run={run} />
          <div className="mt-4 flex flex-wrap gap-2">
            {!started && (
              <button type="button" disabled={busy} onClick={() => run([{ op: "start", pid: p.id }], `${p.name}を開始にしました`)} className={SUB}>
                ▶ 工程の開始
              </button>
            )}
            {started && (
              <button
                type="button"
                disabled={busy || p.ships.length > 0}
                title={p.ships.length ? "出荷の記録があるので取り消せません（先に出荷を取り消してください）" : ""}
                onClick={() => run([{ op: "undoStart", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "開始を取り消しました")}
                className={DANGER}
              >
                工程の開始を取り消す
              </button>
            )}
          </div>
        </div>
      )}
      {!done && !isShip && (
        <div className="mt-4 rounded-lg bg-card p-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-2 text-sm">
              工程の完成数量（良品）
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={`${INPUT} w-32 text-right`} />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              不良数
              <input value={ng} onChange={(e) => setNg(e.target.value)} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
            </label>
            {Number(ng) > 0 && (
              <label className="flex flex-col gap-2 text-sm">
                不良の理由
                <ReasonSelect value={why} onChange={setWhy} reasons={lists.reasons} />
              </label>
            )}
          </div>
          <label className="mt-4 flex flex-col gap-2 text-sm">
            工程のコメント
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="rounded border border-ink-sub bg-white p-2 text-base" />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            {!started && (
              <button type="button" disabled={busy} onClick={() => run([{ op: "start", pid: p.id }], `${p.name}を開始にしました`)} className={SUB}>
                ▶ 工程の開始
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run([doneAct()], `${p.name}を完了にしました`)}
              className={MAIN}
            >
              ✔ 工程の完了
            </button>
            <button type="button" disabled={busy} onClick={() => run([{ op: "pMemo", pid: p.id, memo }], "コメントを保存しました")} className={SUB}>
              コメントだけ保存
            </button>
            {started && (
              <button
                type="button"
                disabled={busy || live.length > 0}
                title={live.length ? "作業の記録があるので取り消せません（先に作業を取り消してください）" : ""}
                onClick={() => run([{ op: "undoStart", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "開始を取り消しました")}
                className={DANGER}
              >
                工程の開始を取り消す
              </button>
            )}
          </div>
        </div>
      )}
      {done && isShip && <ShipList p={p} busy={busy} run={run} />}
      {done && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm(isShip ? "出荷の工程の完了を取り消します。この工程の出荷の記録も全部取り消します。よろしいですか？" : `${p.name}の完了を取り消します。よろしいですか？`)) return;
              run([{ op: "undoDone", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "完了を取り消しました");
            }}
            className={DANGER}
          >
            工程の完了を取り消す
          </button>
        </div>
      )}

      {/* ── 工程の中の作業 ── */}
      {!done && !isShip && (
        <section className="mt-8">
          <h4 className="text-xl font-bold">作業（{live.length}件）</h4>
          <p className="mt-2 text-sm text-ink-sub">1つの工程に何回でも記録できます。作業を終えても、工程は自動では完了になりません。</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-2 text-sm">
              機械
              <MachineSelect value={mc} onChange={setMc} machines={lists.machines} />
            </label>
            <button type="button" disabled={busy} onClick={() => run([{ op: "wStart", pid: p.id, mc }], "作業を始めました")} className={MAIN}>
              ▶ 作業を始める（{worker || "作業者を選んでください"}）
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {live.map((w) => (
              <WorkRowView key={w.id} w={w} canEdit={mine(w)} busy={busy} lists={lists} run={run} />
            ))}
          </div>
          <AddWork pid={p.id} busy={busy} lists={lists} run={run} defaultMc={mc} />
        </section>
      )}
      {(done || isShip) && live.length > 0 && (
        <section className="mt-8">
          <h4 className="text-xl font-bold">作業（{live.length}件）</h4>
          <div className="mt-2 flex flex-col gap-2">
            {live.map((w) => (
              <WorkRowView key={w.id} w={w} canEdit={false} busy={busy} lists={lists} run={run} />
            ))}
          </div>
          {done && <p className="mt-2 text-sm text-ink-sub">完了した工程の作業は直せません（先に「工程の完了を取り消す」）。</p>}
        </section>
      )}
    </div>
  );
}

function ReasonSelect({ value, onChange, reasons }: { value: string; onChange: (v: string) => void; reasons: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">（選ぶ）</option>
      {reasons.map((r) => (
        <option key={r}>{r}</option>
      ))}
    </select>
  );
}

function MachineSelect({ value, onChange, machines }: { value: string; onChange: (v: string) => void; machines: string[] }) {
  const list = value && !machines.includes(value) ? [value, ...machines] : machines;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">（なし）</option>
      {list.map((m) => (
        <option key={m}>{m}</option>
      ))}
    </select>
  );
}

function WorkRowView({
  w,
  canEdit,
  busy,
  lists,
  run,
}: {
  w: BoardWork;
  canEdit: boolean;
  busy: boolean;
  lists: { machines: string[]; reasons: string[] };
  run: (acts: Act[], msg: string) => Promise<boolean>;
}) {
  const ongoing = !w.ended_at;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ qty: w.good_qty, ng: w.defect_qty, memo: w.comment, mc: w.machine, why: w.defect_reason, s: w.started_at, e: w.ended_at });
  return (
    <div className={`rounded border p-2 text-base ${ongoing ? "border-[#B08A00] bg-warn-bg" : "border-line"}`}>
      <p>
        <b>{w.worker}</b>　{w.started_at} 〜 {w.ended_at || "作業中"}
        {w.machine && `　機械 ${w.machine}`}
        {(w.good_qty || w.defect_qty) && `　完成 ${w.good_qty || 0}・不良 ${w.defect_qty || 0}`}
        {w.defect_reason && `（${w.defect_reason}）`}
        {w.comment && `　${w.comment}`}
        {w.source_key && <span className="ml-2 rounded border border-line px-1 text-sm">エムネット</span>}
      </p>
      {canEdit && (ongoing || edit) && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {edit && (
            <>
              <label className="flex flex-col gap-2 text-sm">
                開始
                <input value={f.s} onChange={(e) => setF({ ...f, s: e.target.value })} className={`${INPUT} w-44`} />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                終了
                <input value={f.e} onChange={(e) => setF({ ...f, e: e.target.value })} className={`${INPUT} w-44`} placeholder="空＝作業中" />
              </label>
            </>
          )}
          <label className="flex flex-col gap-2 text-sm">
            完成数
            <input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            不良数
            <input value={f.ng} onChange={(e) => setF({ ...f, ng: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
          </label>
          {Number(f.ng) > 0 && (
            <label className="flex flex-col gap-2 text-sm">
              不良の理由
              <ReasonSelect value={f.why} onChange={(v) => setF({ ...f, why: v })} reasons={lists.reasons} />
            </label>
          )}
          <label className="flex flex-col gap-2 text-sm">
            機械
            <MachineSelect value={f.mc} onChange={(v) => setF({ ...f, mc: v })} machines={lists.machines} />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            コメント
            <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} w-56`} />
          </label>
          {edit ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await run([{ op: "wEdit", wid: w.id, base: w.mark, ...f, why: Number(f.ng) > 0 ? f.why : "" }], "作業を直しました")) setEdit(false);
              }}
              className={MAIN}
            >
              直したものを保存
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => run([{ op: "wEnd", wid: w.id, ...f, why: Number(f.ng) > 0 ? f.why : "" }], "作業を終えました")} className={MAIN}>
              ■ 終える
            </button>
          )}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!edit && (
            <button type="button" disabled={busy} onClick={() => setEdit(true)} className={SUB}>
              直す
            </button>
          )}
          {edit && (
            <button type="button" disabled={busy} onClick={() => setEdit(false)} className={SUB}>
              やめる
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm("この作業の記録を取り消します。よろしいですか？") && run([{ op: "wUndo", wid: w.id }], "作業を取り消しました")}
            className={DANGER}
          >
            取り消す
          </button>
        </div>
      )}
    </div>
  );
}

function AddWork({
  pid,
  busy,
  lists,
  run,
  defaultMc,
}: {
  pid: string;
  busy: boolean;
  lists: { machines: string[]; reasons: string[] };
  run: (acts: Act[], msg: string) => Promise<boolean>;
  defaultMc: string;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ qty: "", ng: "", why: "", memo: "", mc: defaultMc });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${SUB} mt-4`}>
        終わった作業をあとから記録する
      </button>
    );
  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 rounded border border-line p-2">
      <label className="flex flex-col gap-2 text-sm">
        完成数
        <input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        不良数
        <input value={f.ng} onChange={(e) => setF({ ...f, ng: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
      </label>
      {Number(f.ng) > 0 && (
        <label className="flex flex-col gap-2 text-sm">
          不良の理由
          <ReasonSelect value={f.why} onChange={(v) => setF({ ...f, why: v })} reasons={lists.reasons} />
        </label>
      )}
      <label className="flex flex-col gap-2 text-sm">
        機械
        <MachineSelect value={f.mc} onChange={(v) => setF({ ...f, mc: v })} machines={lists.machines} />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        コメント
        <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} w-56`} />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (await run([{ op: "wAdd", pid, ...f, why: Number(f.ng) > 0 ? f.why : "" }], "作業を記録しました")) {
            setOpen(false);
            setF({ qty: "", ng: "", why: "", memo: "", mc: defaultMc });
          }
        }}
        className={MAIN}
      >
        ＋記録
      </button>
      <button type="button" onClick={() => setOpen(false)} className={SUB}>
        やめる
      </button>
    </div>
  );
}

/** この工程で記録した出荷（取り消していないもの）。1件ずつ取り消せる（工程の完了はそのまま） */
function ShipList({ p, busy, run }: { p: BoardProc; busy: boolean; run: (acts: Act[], msg: string) => Promise<boolean> }) {
  if (!p.ships.length) return null;
  return (
    <div className="mt-4">
      <h4 className="text-base font-bold">この工程の出荷（{p.ships.length}件）</h4>
      <div className="mt-2 flex flex-col gap-2">
        {p.ships.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-4 rounded border border-line p-2 text-base">
            <span>
              {s.ship_date}　<b>{s.qty}個</b>
              {s.carrier && `　${s.carrier}`}
              {s.slip_no && `　${s.slip_no}`}
              {s.from_stock === "1" && "　（在庫から）"}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm(`${s.ship_date} ${s.qty}個の出荷を取り消します。よろしいですか？`) && run([{ op: "unship", sid: s.id }], "出荷を取り消しました")}
              className={`${DANGER} ml-auto`}
            >
              この出荷を取り消す
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
