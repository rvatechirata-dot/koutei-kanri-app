"use client";

/**
 * 工程の大きい画面（案D・2026-11-22 川﨑）。工程の札・工程カードを押すと、画面の上に重ねて開く。
 * 上に「① 作業を始める → ② 数を入れて終える → ③ 工程を完了」の段を出し、今やることだけを大きいボタンにする。
 * 作業を終えるときに「終えて、工程も完了」「終える（工程は続く）」を選ぶ（作業を終えても工程が完了しない押し忘れを防ぐ）。
 * 作業を分けない工程は「作業を分けずに完了」で、数を入れて完了するだけでよい。
 * 下に、この工程の作業の記録を表で出す（行ごとに直す・取り消す。一番下で終わった作業をあとから記録）。
 * 出荷の工程は出荷の欄（ShipForm）。作業者＝ログインした人（共有メールのときだけ、画面の上で選んだ人）。
 */
import { useEffect, useState } from "react";
import type { BoardItem, BoardProc, BoardWork } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import { stockRole } from "@/lib/kotei/rules";
import ShipForm from "./ShipForm";
import MemoBox from "./MemoBox";

export type Send = (acts: Act[], doneMsg: string) => Promise<boolean>;

const BTN = "min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50";
const MAIN = `${BTN} bg-accent text-white`;
const BIG = "min-h-16 w-full rounded-lg bg-accent px-4 text-xl font-bold text-white disabled:opacity-50";
const SUB = `${BTN} border border-accent bg-white text-accent`;
const DANGER = `${BTN} border border-danger bg-white text-danger`;
const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const sumGood = (ws: BoardWork[]) => ws.reduce((t, w) => t + (Number(w.good_qty) || 0), 0);
const sumNg = (ws: BoardWork[]) => ws.reduce((t, w) => t + (Number(w.defect_qty) || 0), 0);

export default function ProcPanel({
  it,
  p,
  me,
  worker,
  lists,
  send,
  onClose,
  onMemoSaved,
}: {
  it: BoardItem;
  p: BoardProc;
  me: { name: string; admin: boolean; named?: boolean; email?: string };
  worker: string;
  lists: { machines: string[]; reasons: string[] };
  send: Send;
  onClose: () => void;
  /** 案件メモ欄で書いたあとに画面を読み直す */
  onMemoSaved?: () => void;
}) {
  const role = stockRole(it.kubun, it.procs);
  const isShip = role?.ship === p.id;
  const done = !!p.done_at;
  const started = !!p.started_at;
  const [busy, setBusy] = useState(false);
  const live = p.works;
  const myNow = live.find((w) => !w.ended_at && w.worker === worker) ?? null;
  const itemQty = Number(it.qty) || 0;

  // Esc で閉じる・後ろの画面を動かさない
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = old;
    };
  }, [onClose]);

  const run = async (acts: Act[], msg: string) => {
    setBusy(true);
    const ok = await send(acts, msg);
    setBusy(false);
    return ok;
  };

  // 段：1 始める／2 数を入れて終える／3 工程を完了
  const step = done ? 4 : myNow ? 2 : 1;
  const idx = it.procs.findIndex((x) => x.id === p.id);
  const next = done ? it.procs.slice(idx + 1).find((x) => !x.done_at) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${p.name}の工程`}>
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        {/* 見出し */}
        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <p className="text-sm text-ink-sub">
              {it.mgmt_no}　{it.drawing_no} {it.name}　{it.qty ? `${it.qty}個` : ""}
            </p>
            <h3 className="mt-1 text-2xl font-bold">
              {idx + 1} {p.in_out === "外注" && <span className="mr-2 text-base">外注</span>}
              {p.name}
              {p.machine && <span className="ml-2 text-base font-normal text-ink-sub">{p.machine}</span>}
              <StateTag done={done} started={started} />
            </h3>
            <p className="mt-1 text-sm text-ink-sub">
              {[p.assignee && p.assignee !== "-" && `担当 ${p.assignee}`, p.plan_start && `開始予定 ${p.plan_start}`, p.due && `納期 ${p.due}`, started && `開始 ${p.started_at}${p.started_by ? `（${p.started_by}）` : ""}`, done && `完了 ${p.done_at}${p.done_by ? `（${p.done_by}）` : ""}`]
                .filter(Boolean)
                .join("・")}
            </p>
          </div>
          <button type="button" onClick={onClose} className={`${SUB} ml-auto shrink-0`}>
            閉じる
          </button>
        </div>

        {/* 案件メモ欄：品番の注意（黄色）を必ず出す・この案件のメモは畳む（2026-11-24） */}
        <div className="mt-4">
          <MemoBox it={it} me={{ ...me, named: me.named ?? true }} worker={worker} compact onSaved={onMemoSaved} />
        </div>

        {/* 段 */}
        {!isShip && (
          <ol className="mt-4 grid grid-cols-3 gap-1 text-center text-sm">
            {["作業を始める", "数を入れて終える", "工程を完了"].map((t, k) => {
              const n = k + 1;
              const cls = n < step ? "bg-[#E6F2EC] text-ink" : n === step ? "bg-accent font-bold text-white" : "bg-card text-ink-sub";
              return (
                <li key={t} className={`rounded py-2 ${cls}`}>
                  {n < step ? "済 " : ""}
                  {n} {t}
                </li>
              );
            })}
          </ol>
        )}

        {/* 今やること */}
        <div className="mt-4">
          {isShip && !done && (
            <>
              <ShipForm pid={p.id} name={p.name} qty={itemQty} shipped={p.shipped} worker={worker} busy={busy} run={run} />
              <ShipList p={p} busy={busy} run={run} />
              {started && (
                <button
                  type="button"
                  disabled={busy || p.ships.length > 0}
                  title={p.ships.length ? "出荷の記録があるので取り消せません（先に出荷を取り消してください）" : ""}
                  onClick={() => run([{ op: "undoStart", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "開始を取り消しました")}
                  className={`${DANGER} mt-4`}
                >
                  工程の開始を取り消す
                </button>
              )}
            </>
          )}
          {!isShip && !done && step === 1 && <StartStep p={p} it={it} worker={worker} lists={lists} busy={busy} run={run} />}
          {!isShip && !done && step === 2 && myNow && <EndStep key={myNow.id} p={p} w={myNow} itemQty={itemQty} lists={lists} busy={busy} run={run} />}
          {done && (
            <div className="rounded-lg border border-ok bg-[#E6F2EC] p-4">
              <p className="text-lg">
                <b>済 完了</b>　完成 {p.done_qty || "－"}
                {p.defect_qty ? `・不良 ${p.defect_qty}` : ""}
                {p.defect_reason ? `（${p.defect_reason}）` : ""}
              </p>
              {next && <p className="mt-1 text-base">次の工程：<b>{next.name}</b>{next.machine && `（${next.machine}）`}</p>}
              {isShip && <ShipList p={p} busy={busy} run={run} />}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm(isShip ? "出荷の工程の完了を取り消します。この工程の出荷の記録も全部取り消します。よろしいですか？" : `${p.name}の完了を取り消します。よろしいですか？`)) return;
                  run([{ op: "undoDone", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "完了を取り消しました");
                }}
                className={`${DANGER} mt-4`}
              >
                完了を取り消す
              </button>
            </div>
          )}
        </div>

        {/* 作業の記録 */}
        {(!isShip || live.length > 0) && (
          <section className="mt-6">
            <h4 className="text-lg font-bold">
              この工程の作業の記録（{live.length}件）
              {live.length > 0 && <span className="ml-2 text-base font-normal text-ink-sub">完成 計{fmt(sumGood(live))}{sumNg(live) ? `・不良 計${fmt(sumNg(live))}` : ""}</span>}
            </h4>
            <div className="mt-2 flex flex-col gap-1">
              {live.length === 0 && <p className="text-base text-ink-sub">まだありません。</p>}
              {live.map((w) => (
                <WorkLine key={w.id} w={w} canEdit={!done && !isShip && (me.admin || w.worker === worker)} busy={busy} lists={lists} run={run} />
              ))}
            </div>
            {!done && !isShip && <AddWork pid={p.id} busy={busy} lists={lists} run={run} defaultMc={p.machine} />}
            {done && live.length > 0 && <p className="mt-2 text-sm text-ink-sub">完了した工程の作業は直せません（先に「完了を取り消す」）。</p>}
          </section>
        )}

        {/* 工程のコメント */}
        {!isShip && <ProcMemo p={p} busy={busy} run={run} />}

        {!isShip && !done && started && live.length === 0 && (
          <button type="button" disabled={busy} onClick={() => run([{ op: "undoStart", pid: p.id, base: { s: p.started_at, e: p.done_at } }], "開始を取り消しました")} className={`${DANGER} mt-6`}>
            工程の開始を取り消す
          </button>
        )}
      </div>
    </div>
  );
}

function StateTag({ done, started }: { done: boolean; started: boolean }) {
  const [t, c] = done ? ["済 完了", "border-ok bg-[#E6F2EC]"] : started ? ["中 作業中", "border-[#B08A00] bg-warn-bg"] : ["まだ", "border-line bg-card text-ink-sub"];
  return <span className={`ml-2 inline-block rounded border px-2 align-middle text-base font-bold ${c}`}>{t}</span>;
}

/** ① 作業を始める（または、作業を分けずに完了） */
function StartStep({
  p,
  it,
  worker,
  lists,
  busy,
  run,
}: {
  p: BoardProc;
  it: BoardItem;
  worker: string;
  lists: { machines: string[]; reasons: string[] };
  busy: boolean;
  run: (acts: Act[], msg: string) => Promise<boolean>;
}) {
  const [mc, setMc] = useState(p.machine || "");
  const others = p.works.filter((w) => !w.ended_at);
  const goodSoFar = sumGood(p.works);
  const [quick, setQuick] = useState(false);
  const [qty, setQty] = useState(p.works.length ? fmt(goodSoFar) : p.done_qty || it.qty || "");
  const [ng, setNg] = useState(p.works.length ? fmt(sumNg(p.works)) || "" : p.defect_qty || "");
  const [why, setWhy] = useState(p.defect_reason || "");
  return (
    <div className="rounded-lg bg-card p-4">
      {others.length > 0 && <p className="mb-2 text-base">いま作業中：<b>{others.map((w) => w.worker).join("・")}</b></p>}
      <label className="flex items-center gap-2 text-base">
        機械
        <MachineSelect value={mc} onChange={setMc} machines={lists.machines} />
      </label>
      <button type="button" disabled={busy} onClick={() => run([{ op: "wStart", pid: p.id, mc }], `${p.name}の作業を始めました`)} className={`${BIG} mt-2`}>
        ▶ 作業を始める（{worker || "作業者を選んでください"}）
      </button>
      {!quick ? (
        <button type="button" onClick={() => setQuick(true)} className={`${SUB} mt-4`}>
          作業を分けずに、数を入れて工程を完了する
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-line bg-white p-4">
          <p className="text-base font-bold">工程を完了する</p>
          <Counter label="完成数（良品）" value={qty} onChange={setQty} all={it.qty ? { label: `全部 ${it.qty}個`, v: it.qty } : undefined} />
          <Counter label="不良数" value={ng} onChange={setNg} />
          {Number(ng) > 0 && (
            <label className="mt-2 flex items-center gap-2 text-base">
              不良の理由
              <ReasonSelect value={why} onChange={setWhy} reasons={lists.reasons} />
            </label>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy || qty === ""} onClick={() => run([{ op: "done", pid: p.id, qty, ng, why: Number(ng) > 0 ? why : "" }], `${p.name}を完了にしました`)} className={MAIN}>
              ✔ 工程を完了
            </button>
            <button type="button" onClick={() => setQuick(false)} className={SUB}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ② 数を入れて終える → ③ 工程も完了にするか選ぶ */
function EndStep({
  p,
  w,
  itemQty,
  lists,
  busy,
  run,
}: {
  p: BoardProc;
  w: BoardWork;
  itemQty: number;
  lists: { machines: string[]; reasons: string[] };
  busy: boolean;
  run: (acts: Act[], msg: string) => Promise<boolean>;
}) {
  const ended = p.works.filter((x) => x.id !== w.id && x.ended_at);
  const left = Math.max(0, itemQty - sumGood(ended));
  const [f, setF] = useState({ qty: w.good_qty, ng: w.defect_qty, why: w.defect_reason, mc: w.machine, memo: w.comment });
  const [ask, setAsk] = useState(false);
  const why = Number(f.ng) > 0 ? f.why : "";
  const end: Act = { op: "wEnd", wid: w.id, qty: f.qty, ng: f.ng, memo: f.memo, mc: f.mc, why };
  const totalGood = fmt(sumGood(ended) + (Number(f.qty) || 0));
  const totalNg = fmt(sumNg(ended) + (Number(f.ng) || 0));
  return (
    <div className="rounded-lg border border-[#B08A00] bg-warn-bg p-4">
      <p className="text-base">
        <b>{w.worker}</b>　{w.started_at}〜 作業中{w.machine && `　機械 ${w.machine}`}
      </p>
      <Counter label="完成数（良品）" value={f.qty} onChange={(v) => setF({ ...f, qty: v })} all={left > 0 ? { label: `残り全部 ${fmt(left)}個`, v: fmt(left) } : undefined} />
      <Counter label="不良数" value={f.ng} onChange={(v) => setF({ ...f, ng: v })} />
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {Number(f.ng) > 0 && (
          <label className="flex items-center gap-2 text-base">
            不良の理由
            <ReasonSelect value={f.why} onChange={(v) => setF({ ...f, why: v })} reasons={lists.reasons} />
          </label>
        )}
        <label className="flex items-center gap-2 text-base">
          機械
          <MachineSelect value={f.mc} onChange={(v) => setF({ ...f, mc: v })} machines={lists.machines} />
        </label>
        <label className="flex flex-1 items-center gap-2 text-base">
          コメント
          <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} min-w-0 flex-1`} />
        </label>
      </div>
      {!ask ? (
        <button type="button" disabled={busy || f.qty === ""} onClick={() => setAsk(true)} className={`${BIG} mt-4`}>
          ■ 作業を終える
        </button>
      ) : (
        <div className="mt-4 rounded-lg border-2 border-accent bg-white p-4">
          <p className="text-lg font-bold">この工程は、これで全部終わりですか？</p>
          <p className="text-base text-ink-sub">
            工程の完成 {totalGood}
            {itemQty ? ` / ${itemQty}個` : ""}
            {Number(totalNg) > 0 ? `・不良 ${totalNg}` : ""}（ほかの人の作業も合わせた数）
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run([end, { op: "done", pid: p.id, qty: totalGood, ng: Number(totalNg) > 0 ? totalNg : "", why }], `作業を終えて、${p.name}を完了にしました`)}
              className="min-h-16 rounded-lg bg-accent px-4 text-lg font-bold text-white disabled:opacity-50"
            >
              ✔ はい。終えて、工程も完了
            </button>
            <button type="button" disabled={busy} onClick={() => run([end], "作業を終えました（工程は続きます）")} className="min-h-16 rounded-lg border-2 border-accent bg-white px-4 text-lg font-bold text-accent disabled:opacity-50">
              いいえ。終える（工程は続く）
            </button>
          </div>
          <button type="button" onClick={() => setAsk(false)} className={`${SUB} mt-2`}>
            ← 数を直す
          </button>
        </div>
      )}
    </div>
  );
}

/** 数の欄（−・＋の大きいボタンつき。手袋・iPadでも押しやすく） */
function Counter({ label, value, onChange, all }: { label: string; value: string; onChange: (v: string) => void; all?: { label: string; v: string } }) {
  const add = (d: number) => onChange(fmt(Math.max(0, (Number(value) || 0) + d)));
  const KEY = "h-12 w-12 rounded-lg border border-ink-sub bg-white text-2xl font-bold";
  return (
    <div className="mt-2">
      <p className="text-sm">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => add(-1)} className={KEY} aria-label={`${label}を1減らす`}>
          −
        </button>
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-12 w-28 rounded border border-ink-sub bg-white text-center text-2xl" aria-label={label} />
        <button type="button" onClick={() => add(1)} className={KEY} aria-label={`${label}を1増やす`}>
          ＋
        </button>
        {all && (
          <button type="button" onClick={() => onChange(all.v)} className={SUB}>
            {all.label}
          </button>
        )}
      </div>
    </div>
  );
}

function ProcMemo({ p, busy, run }: { p: BoardProc; busy: boolean; run: (acts: Act[], msg: string) => Promise<boolean> }) {
  const [memo, setMemo] = useState(p.comment || "");
  return (
    <details className="mt-6 text-base" open={!!p.comment}>
      <summary className="cursor-pointer text-accent">工程のコメント{p.comment ? `：${p.comment}` : "（なし）"}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={memo} onChange={(e) => setMemo(e.target.value)} className={`${INPUT} min-w-0 flex-1`} />
        <button type="button" disabled={busy || memo === (p.comment || "")} onClick={() => run([{ op: "pMemo", pid: p.id, memo }], "コメントを保存しました")} className={SUB}>
          コメントを保存
        </button>
      </div>
    </details>
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

/** 作業の記録1行。「直す」を押すとその行だけ入力欄になる */
function WorkLine({
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
  const fromW = () => ({ qty: w.good_qty, ng: w.defect_qty, memo: w.comment, mc: w.machine, why: w.defect_reason, s: w.started_at, e: w.ended_at });
  const [f, setF] = useState(fromW);
  return (
    <div className={`rounded border p-2 text-base ${ongoing ? "border-[#B08A00] bg-warn-bg" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <b>{w.worker}</b>
        <span>
          {w.started_at.slice(5)} 〜 {w.ended_at ? w.ended_at.slice(5) : <b>作業中</b>}
        </span>
        {w.machine && <span className="text-ink-sub">機械 {w.machine}</span>}
        {(w.good_qty || w.defect_qty) && (
          <span>
            完成 <b>{w.good_qty || 0}</b>
            {Number(w.defect_qty) > 0 && `・不良 ${w.defect_qty}`}
            {w.defect_reason && `（${w.defect_reason}）`}
          </span>
        )}
        {w.comment && <span className="text-ink-sub">{w.comment}</span>}
        {w.source_key && <span className="rounded border border-line px-1 text-sm">エムネット</span>}
        {canEdit && !edit && (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // 押したときの記録から入れ直す（前に開いたときの古い値で、終了の時刻などを消さないように）
                setF(fromW());
                setEdit(true);
              }}
              className={SUB}
            >
              直す
            </button>
            <button type="button" disabled={busy} onClick={() => confirm(`${w.worker}さんのこの作業の記録を取り消します。よろしいですか？`) && run([{ op: "wUndo", wid: w.id }], "作業を取り消しました")} className={DANGER}>
              取り消す
            </button>
          </span>
        )}
      </div>
      {canEdit && edit && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            開始
            <input value={f.s} onChange={(e) => setF({ ...f, s: e.target.value })} className={`${INPUT} w-44`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            終了
            <input value={f.e} onChange={(e) => setF({ ...f, e: e.target.value })} className={`${INPUT} w-44`} placeholder="空＝作業中" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            完成数
            <input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            不良数
            <input value={f.ng} onChange={(e) => setF({ ...f, ng: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
          </label>
          {Number(f.ng) > 0 && (
            <label className="flex flex-col gap-1 text-sm">
              不良の理由
              <ReasonSelect value={f.why} onChange={(v) => setF({ ...f, why: v })} reasons={lists.reasons} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            機械
            <MachineSelect value={f.mc} onChange={(v) => setF({ ...f, mc: v })} machines={lists.machines} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            コメント
            <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} w-56`} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run([{ op: "wEdit", wid: w.id, base: w.mark, ...f, why: Number(f.ng) > 0 ? f.why : "" }], "作業を直しました")) setEdit(false);
            }}
            className={MAIN}
          >
            保存
          </button>
          <button type="button" onClick={() => setEdit(false)} className={SUB}>
            やめる
          </button>
        </div>
      )}
    </div>
  );
}

/** 終わった作業をあとから記録（作業の記録の一番下の行） */
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
  const [f, setF] = useState({ qty: "", ng: "", why: "", memo: "", mc: defaultMc });
  return (
    <div className="mt-2 rounded border border-dashed border-ink-sub p-2">
      <p className="text-sm text-ink-sub">終わった作業をあとから記録する（作業者は自分・日時は今）</p>
      <div className="mt-1 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          完成数
          <input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          不良数
          <input value={f.ng} onChange={(e) => setF({ ...f, ng: e.target.value })} inputMode="decimal" className={`${INPUT} w-24 text-right`} />
        </label>
        {Number(f.ng) > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            不良の理由
            <ReasonSelect value={f.why} onChange={(v) => setF({ ...f, why: v })} reasons={lists.reasons} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          機械
          <MachineSelect value={f.mc} onChange={(v) => setF({ ...f, mc: v })} machines={lists.machines} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          コメント
          <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} w-48`} />
        </label>
        <button
          type="button"
          disabled={busy || (f.qty === "" && f.ng === "")}
          onClick={async () => {
            if (await run([{ op: "wAdd", pid, ...f, why: Number(f.ng) > 0 ? f.why : "" }], "作業を記録しました")) setF({ qty: "", ng: "", why: "", memo: "", mc: defaultMc });
          }}
          className={SUB}
        >
          ＋記録
        </button>
      </div>
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
          <div key={s.id} className="flex flex-wrap items-center gap-4 rounded border border-line bg-white p-2 text-base">
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
