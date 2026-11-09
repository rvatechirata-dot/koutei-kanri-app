"use client";

/**
 * ガント（4段目）。横棒＝工程の「開始予定〜納期」。色と字で まだ／中（作業中）／済（完了）／遅れ（納期すぎで終わっていない）。
 * 土日・休日は灰色、今日は青い縦線。棒を押すと（管理者だけ）開始予定・納期を直せる。
 * 「後ろの工程もずらす」にすると、納期を動かした日数だけ後ろの工程も同じだけずらす（「休日を数えない」なら稼働日で数える）。
 * 試作は棒を引っぱって動かしたが、ここでは押して日付を直す（指で誤って動かさないため）。
 * 複数選ぶ（試作と同じ）：Ctrl か Shift を押しながら棒を押す／「複数選ぶ」を入れて押す と、選ぶ・外すになる。
 *   選んだ棒は上の帯の「−1日」「＋1日」「○日ずらす」で、全部同じだけ動かす（開始予定と納期の両方）。Esc か「選ぶのをやめる」で外す。
 *   引っぱって動かすことはしない（指で誤って動かさないため）。動かす前に確かめる。
 * 元に戻す（1回）：直前に保存した予定の変更を、変える前の予定に戻す（ほかの人が間に変えていたら、サーバーが断る）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import { todayJst } from "@/lib/kotei/time";
import { isItemDone } from "@/lib/kotei/rules";

type Me = { name: string; named: boolean; admin: boolean };
const DAY_W = 32; // 1日の幅（px）
const LEFT_W = 288; // 左の品目の欄の幅（px）
const SPANS: [number, string][] = [
  [14, "2週"],
  [31, "1か月"],
  [92, "3か月"],
];

const toUtc = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("/").map(Number);
  return Date.UTC(y, m - 1, dd);
};
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "/");
const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * 86400000);
const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);

type Change = { pid: string; s: string; e: string; base: { s: string; e: string } };

/** 予定の文字（YYYY/MM/DD か YYYY/MM/DD HH:MM）を、時刻はそのままで n 日ずらす（work なら土日・休日を数えない） */
function shiftDate(d: string, n: number, work: boolean, isOff: (d: string) => boolean): string {
  if (!d || !n) return d;
  const time = d.length > 10 ? d.slice(10) : "";
  let x = d.slice(0, 10);
  if (!work) return addDays(x, n) + time;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    x = addDays(x, step);
    if (!isOff(x)) left--;
  }
  return x + time;
}

/** 「3」「−2」「－２」などを整数にする（数でなければ 0） */
const toInt = (v: string) => {
  const n = Number(v.normalize("NFKC").replace(/[−－ー]/g, "-").trim());
  return Number.isInteger(n) ? n : 0;
};

export default function GanttView() {
  const today = todayJst();
  const [board, setBoard] = useState<(Board & { me: Me }) | null>(null);
  const [hol, setHol] = useState<Set<string>>(new Set());
  const [span, setSpan] = useState(31);
  const [start, setStart] = useState(() => addDays(today, -3));
  const [q, setQ] = useState("");
  const [noPlan, setNoPlan] = useState(false);
  const [edit, setEdit] = useState<{ it: BoardItem; p: BoardProc } | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  /** 複数選んだ棒（工程ID） */
  const [selRaw, setSel] = useState<Set<string>>(new Set());
  /** 「複数選ぶ」を入れているか（タブレット用。入れると棒を押すたびに選ぶ・外す） */
  const [selMode, setSelMode] = useState(false);
  const [shiftN, setShiftN] = useState("1");
  const [shiftWork, setShiftWork] = useState(true);
  /** 元に戻す（1回）：直前の変更を戻すための中身 */
  const [undo, setUndo] = useState<{ label: string; changes: Change[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([fetch("/api/board", { cache: "no-store" }).then((r) => r.json()), fetch("/api/plan", { cache: "no-store" }).then((r) => r.json())])
        .then(([b, h]) => {
          setBoard(b as Board & { me: Me });
          setHol(new Set((h as { date: string }[]).map((x) => x.date)));
        })
        .catch(() => setMsg({ text: "読み込めませんでした。", bad: true })),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  // Esc で選んだ棒を外す（小窓が開いていれば小窓を閉じる）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (edit) setEdit(null);
      else setSel(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);

  /** 予定の変更を送る。うまくいけば「元に戻す」に、変える前の予定を覚える（元に戻したときは消す） */
  const sendPlan = useCallback(
    async (changes: Change[], label: string, isUndo = false): Promise<boolean> => {
      setBusy(true);
      try {
        const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string; changed?: number };
        if (!r.ok) {
          if (isUndo) setUndo(null);
          setMsg({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）", bad: true });
          await load();
          return false;
        }
        setUndo(isUndo ? null : { label, changes: changes.map((c) => ({ pid: c.pid, s: c.base.s, e: c.base.e, base: { s: c.s, e: c.e } })) });
        setMsg({ text: `${isUndo ? `元に戻しました：${label}` : label}（${j.changed ?? 0}件）` });
        await load();
        return true;
      } catch {
        setMsg({ text: "つながりませんでした。何も保存されていません。", bad: true });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(start, i)), [start, span]);
  const isOff = useCallback((d: string) => {
    const w = new Date(toUtc(d)).getUTCDay();
    return w === 0 || w === 6 || hol.has(d);
  }, [hol]);

  /** 工程ID → 品目と工程（選んだ棒を探す） */
  const byPid = useMemo(() => {
    const m = new Map<string, { it: BoardItem; p: BoardProc }>();
    board?.items.forEach((it) => it.procs.forEach((p) => m.set(p.id, { it, p })));
    return m;
  }, [board]);
  // 読み直して消えた工程・終わった工程は、選んだものに数えない
  const sel = useMemo(() => new Set([...selRaw].filter((id) => byPid.get(id) && !byPid.get(id)!.p.done_at)), [selRaw, byPid]);

  const toggle = (pid: string) =>
    setSel((cur) => {
      const n = new Set(cur);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });

  /** 選んだ棒を全部 n 日ずらす（開始予定と納期の両方） */
  const shiftSelected = async (n: number) => {
    if (!n || !sel.size) return;
    const list = [...sel].map((id) => byPid.get(id)).filter((x): x is { it: BoardItem; p: BoardProc } => !!x);
    const changes: Change[] = list.map(({ p }) => ({
      pid: p.id,
      s: shiftDate(p.plan_start, n, shiftWork, isOff),
      e: shiftDate(p.due, n, shiftWork, isOff),
      base: { s: p.plan_start, e: p.due },
    }));
    const head = list
      .slice(0, 5)
      .map(({ it, p }) => `・${it.mgmt_no} ${p.name}`)
      .join("\n");
    const days = `${n > 0 ? "+" : ""}${n}日${shiftWork ? "（稼働日）" : ""}`;
    if (!confirm(`選んだ ${list.length}本 の開始予定と納期を ${days} ずらします。\n${head}${list.length > 5 ? `\nほか ${list.length - 5}本` : ""}\nよろしいですか？`)) return;
    await sendPlan(changes, `予定の変更 ${list.length}本まとめて（${days}）`);
  };

  const doUndo = async () => {
    if (!undo) return;
    if (!confirm(`直前の変更（${undo.label}）を元に戻します。よろしいですか？`)) return;
    await sendPlan(undo.changes, undo.label, true);
  };

  const rows = useMemo(() => {
    if (!board) return [];
    const k = q.trim().toLowerCase();
    const end = days[days.length - 1];
    return board.items
      .filter((it) => it.hidden !== "1" && it.case_hidden !== "1" && !isItemDone(it.kubun, it.procs))
      .filter((it) => !k || [it.mgmt_no, it.drawing_no, it.name, it.customer].join(" ").toLowerCase().includes(k))
      .filter((it) => {
        const ds = it.procs.flatMap((p) => [p.plan_start, p.due].filter(Boolean).map((x) => x.slice(0, 10)));
        if (!ds.length) return noPlan;
        return ds.some((d) => d >= start && d <= end) || (Math.min(...ds.map(toUtc)) < toUtc(start) && Math.max(...ds.map(toUtc)) > toUtc(end));
      })
      .sort((a, b) => (a.final_due || "9999").localeCompare(b.final_due || "9999"));
  }, [board, q, noPlan, days, start]);

  if (!board) return <p className="py-8 text-base text-ink-sub">{msg?.text || "読み込み中…"}</p>;
  const admin = board.me.admin;
  const SUB = "min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent";
  const width = LEFT_W + span * DAY_W;

  return (
    <div className={sel.size ? "pb-48" : ""}>
      <h1 className="text-2xl font-bold">ガント（予定）</h1>
      {msg && (
        <p role="status" className={`mt-2 whitespace-pre-wrap rounded border bg-white p-2 text-base ${msg.bad ? "border-danger text-danger" : "border-ok"}`}>
          {msg.text}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-card p-4">
        <div className="flex gap-2">
          {SPANS.map(([n, label]) => (
            <button
              key={n}
              type="button"
              onClick={() => setSpan(n)}
              aria-pressed={span === n}
              className={`min-h-11 rounded-lg border px-4 text-base ${span === n ? "border-accent bg-accent font-bold text-white" : "border-accent bg-white text-accent"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setStart(addDays(start, -7))} className={SUB}>
            ← 1週
          </button>
          <button type="button" onClick={() => setStart(addDays(today, -3))} className={SUB}>
            今日
          </button>
          <button type="button" onClick={() => setStart(addDays(start, 7))} className={SUB}>
            1週 →
          </button>
        </div>
        <label className="flex flex-col gap-2 text-sm">
          さがす（管理番号・図面番号・品名・顧客）
          <input value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 w-64 rounded border border-ink-sub bg-white px-2 text-base" />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={noPlan} onChange={(e) => setNoPlan(e.target.checked)} className="h-5 w-5" />
          予定の無い品目も出す
        </label>
      </div>
      {admin && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelMode(!selMode)}
            aria-pressed={selMode}
            className={`min-h-11 rounded-lg border px-4 text-base font-bold ${selMode ? "border-accent bg-accent text-white" : "border-accent bg-white text-accent"}`}
          >
            {selMode ? "☑ 複数選ぶ：オン" : "☐ 複数選ぶ"}
          </button>
          <button type="button" disabled={!undo || busy} onClick={doUndo} title={undo ? undo.label : ""} className={`${SUB} disabled:opacity-50`}>
            ↶ 元に戻す
          </button>
          {undo && <span className="text-sm text-ink-sub">戻せるのは直前の1回：{undo.label}</span>}
          {selMode && <span className="text-base">押した棒を選ぶ・外す（日付の小窓は開きません）</span>}
        </div>
      )}
      {admin && sel.size > 0 && (
        <div
          role="region"
          aria-label="選んだ棒をまとめて動かす"
          className="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg border-2 border-accent bg-white p-4 shadow-lg"
        >
          <b className="text-base">{sel.size}本 選んでいます</b>
          <button type="button" disabled={busy} onClick={() => shiftSelected(-1)} className={`${SUB} disabled:opacity-50`}>
            −1日
          </button>
          <button type="button" disabled={busy} onClick={() => shiftSelected(1)} className={`${SUB} disabled:opacity-50`}>
            ＋1日
          </button>
          <label className="flex items-center gap-2 text-base">
            <input
              value={shiftN}
              onChange={(ev) => setShiftN(ev.target.value)}
              inputMode="numeric"
              aria-label="ずらす日数（前へは −）"
              className="min-h-11 w-20 rounded border border-ink-sub bg-white px-2 text-base"
            />
            日
          </label>
          <button
            type="button"
            disabled={busy || !toInt(shiftN)}
            onClick={() => shiftSelected(toInt(shiftN))}
            className="min-h-11 rounded-lg bg-accent px-4 text-base font-bold text-white disabled:opacity-50"
          >
            ずらす
          </button>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={shiftWork} onChange={(ev) => setShiftWork(ev.target.checked)} className="h-5 w-5" />
            休日を数えない
          </label>
          <button type="button" onClick={() => setSel(new Set())} className={SUB}>
            選ぶのをやめる（Esc）
          </button>
        </div>
      )}
      <p className="mt-2 text-sm text-ink-sub">
        棒＝開始予定〜納期。灰色の列は土日・休日。
        {admin
          ? "棒を押すと予定を直せます。何本かまとめて動かすときは、Ctrl（か Shift）を押しながら押すか、「複数選ぶ」を入れて押します（前へは −3 のように入れます）。"
          : "予定を直せるのは管理者だけです。"}{" "}
        {rows.length}件
      </p>

      <div className="mt-2 overflow-x-auto rounded border border-line">
        <div style={{ width }}>
          {/* 日付の見出し */}
          <div className="sticky top-0 z-10 flex border-b border-line bg-white">
            <div className="shrink-0 border-r border-line px-2 py-1 text-sm font-bold" style={{ width: LEFT_W }}>
              品目
            </div>
            {days.map((d) => (
              <div
                key={d}
                className={`shrink-0 border-r border-line py-1 text-center text-sm ${isOff(d) ? "bg-card text-ink-sub" : ""} ${d === today ? "font-bold text-accent" : ""}`}
                style={{ width: DAY_W }}
                title={d}
              >
                {d.slice(8) === "01" || d === days[0] ? `${Number(d.slice(5, 7))}/` : ""}
                {Number(d.slice(8))}
              </div>
            ))}
          </div>
          {rows.length === 0 && <p className="p-4 text-base text-ink-sub">この期間に予定のある品目がありません。</p>}
          {rows.map((it) => (
            <GRow
              key={it.id}
              it={it}
              days={days}
              today={today}
              isOff={isOff}
              admin={admin}
              sel={sel}
              onPick={(p, multi) => {
                if (multi || selMode) {
                  if (p.done_at) return setMsg({ text: `${p.name}は完了しているので、まとめて動かす方には入れません。`, bad: true });
                  return toggle(p.id);
                }
                setSel(new Set());
                setEdit({ it, p });
              }}
            />
          ))}
        </div>
      </div>

      {edit && (
        <EditBox
          it={edit.it}
          p={edit.p}
          isOff={isOff}
          onClose={() => setEdit(null)}
          busy={busy}
          onSave={async (changes, label) => {
            if (await sendPlan(changes, label)) setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function GRow({
  it,
  days,
  today,
  isOff,
  admin,
  sel,
  onPick,
}: {
  it: BoardItem;
  days: string[];
  today: string;
  isOff: (d: string) => boolean;
  admin: boolean;
  sel: Set<string>;
  onPick: (p: BoardProc, multi: boolean) => void;
}) {
  const first = days[0];
  const last = days[days.length - 1];
  // 見えている期間にかかる工程だけを、上から1段ずつ並べる
  const procs = it.procs.filter((p) => {
    if (!p.plan_start && !p.due) return false;
    const s = (p.plan_start || p.due).slice(0, 10);
    const e = (p.due || p.plan_start).slice(0, 10);
    return e >= first && s <= last;
  });
  const h = Math.max(1, procs.length) * 40 + 8;
  return (
    <div className="flex border-b border-line">
      <div className="shrink-0 border-r border-line px-2 py-1" style={{ width: LEFT_W }}>
        <p className="text-base font-bold">{it.mgmt_no}</p>
        <p className="text-sm text-ink-sub">
          {it.drawing_no} {it.name}
          {it.final_due && `・納期 ${it.final_due.slice(0, 10)}`}
        </p>
      </div>
      <div className="relative shrink-0" style={{ width: days.length * DAY_W, height: h }}>
        {days.map((d, i) =>
          isOff(d) ? <div key={d} className="absolute top-0 bottom-0 bg-card" style={{ left: i * DAY_W, width: DAY_W }} /> : null
        )}
        {today >= first && today <= last && <div className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: diffDays(first, today) * DAY_W + DAY_W / 2 }} aria-hidden />}
        {procs.length === 0 && <p className="absolute top-2 left-2 text-sm text-ink-sub">予定なし</p>}
        {procs.map((p, k) => {
          const s = (p.plan_start || p.due).slice(0, 10);
          const e = (p.due || p.plan_start).slice(0, 10);
          const a = Math.max(diffDays(first, s), -1);
          const b = Math.min(diffDays(first, e), days.length);
          if (b < 0 || a > days.length - 1) return null;
          const late = !p.done_at && !!p.due && p.due.slice(0, 10) < today;
          const st = p.done_at ? "済" : p.started_at ? "中" : late ? "遅れ" : "";
          const cls = p.done_at
            ? "border-ok bg-[#E6F2EC]"
            : p.started_at
              ? "border-[#B08A00] bg-warn-bg font-bold"
              : late
                ? "border-danger bg-white text-danger font-bold"
                : "border-ink-sub bg-white";
          const on = sel.has(p.id);
          const left = Math.max(a, 0) * DAY_W;
          const w = (Math.min(b, days.length - 1) - Math.max(a, 0) + 1) * DAY_W;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!admin}
              aria-pressed={admin ? on : undefined}
              onClick={(ev) => onPick(p, ev.ctrlKey || ev.metaKey || ev.shiftKey)}
              title={`${p.name}\n開始予定 ${p.plan_start || "－"}\n納期 ${p.due || "－"}${p.done_at ? `\n完了 ${p.done_at}` : ""}`}
              className={`absolute flex items-center overflow-hidden rounded border px-1 text-left text-sm whitespace-nowrap ${cls} ${on ? "outline outline-4 outline-accent" : ""} ${admin ? "" : "cursor-default"}`}
              style={{ top: 4 + k * 40, left, width: Math.max(w, DAY_W), height: 36 }}
            >
              {on && <span className="mr-1 font-bold text-accent">✓選</span>}
              {st && <span className="mr-1">{st}</span>}
              {p.in_out === "外注" && <span className="mr-1">外注</span>}
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditBox({
  it,
  p,
  isOff,
  onClose,
  busy,
  onSave,
}: {
  it: BoardItem;
  p: BoardProc;
  isOff: (d: string) => boolean;
  onClose: () => void;
  busy: boolean;
  onSave: (changes: Change[], label: string) => void;
}) {
  const [s, setS] = useState(p.plan_start);
  const [e, setE] = useState(p.due);
  const [tail, setTail] = useState(false);
  const [work, setWork] = useState(true);
  const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
  const idx = it.procs.findIndex((x) => x.id === p.id);
  const after = it.procs.slice(idx + 1).filter((x) => !x.done_at && (x.plan_start || x.due));

  const shift = (d: string, n: number) => shiftDate(d, n, work, isOff);
  /** 動かした日数（work なら稼働日の数） */
  const moved = (): number => {
    const a = (p.due || p.plan_start).slice(0, 10);
    const b = (e || s).slice(0, 10);
    if (!a || !b || a === b) return 0;
    if (!work) return diffDays(a, b);
    const step = b > a ? 1 : -1;
    let n = 0;
    let x = a;
    while (x !== b) {
      x = addDays(x, step);
      if (!isOff(x)) n += step;
    }
    return n;
  };

  const save = () => {
    const n = tail ? moved() : 0;
    const changes: Change[] = [
      { pid: p.id, s: s.trim(), e: e.trim(), base: { s: p.plan_start, e: p.due } },
      ...(n ? after.map((x) => ({ pid: x.id, s: shift(x.plan_start, n), e: shift(x.due, n), base: { s: x.plan_start, e: x.due } })) : []),
    ];
    if (n && !confirm(`${p.name}と、後ろの工程 ${after.length}個を ${n > 0 ? "+" : ""}${n}日${work ? "（稼働日）" : ""}ずらします。よろしいですか？`)) return;
    onSave(changes, `予定の変更 ${it.mgmt_no} ${p.name}${n ? `と後ろ${after.length}個` : ""}`);
  };

  return (
    <div role="dialog" aria-label="予定を直す" className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-2xl rounded-lg border-2 border-accent bg-white p-4 shadow-lg">
      <p className="text-base">
        <b>{it.mgmt_no}</b> {it.drawing_no}　<b>{p.name}</b>
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          開始予定
          <input value={s} onChange={(ev) => setS(ev.target.value)} placeholder="2026/11/10" className={`${INPUT} w-44`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          納期
          <input value={e} onChange={(ev) => setE(ev.target.value)} placeholder="2026/11/12" className={`${INPUT} w-44`} />
        </label>
      </div>
      {after.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={tail} onChange={(ev) => setTail(ev.target.checked)} className="h-5 w-5" />
            後ろの工程（{after.length}個）も同じだけずらす
          </label>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={work} onChange={(ev) => setWork(ev.target.checked)} className="h-5 w-5" />
            休日を数えない（稼働日でずらす）
          </label>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white disabled:opacity-50">
          保存
        </button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-accent bg-white px-4 text-base font-bold text-accent">
          やめる
        </button>
      </div>
    </div>
  );
}
