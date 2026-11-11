"use client";

/**
 * ガント（4段目）。横棒＝工程の「開始予定〜納期」。色と字で まだ／中（作業中）／済（完了）／遅れ（納期すぎで終わっていない）。
 * 土日・休日は灰色、今日は青い縦線。棒を押すと（管理者だけ）開始予定・納期を直せる。
 * 上の帯の「後ろの工程もずらす」（初めはオン・試作と同じ）：小窓・引っぱる・まとめてずらす のどれで動かしても、
 *   納期を動かした日数だけ、同じ品目の後ろの工程（まだ終わっていないもの。出荷も入る）も同じだけずらす。
 *   「休日を数えない」（初めはオン）なら稼働日の数に直してずらす。2本以上選んでいても、同じ工程は1回だけ動かす。
 *   2つの印はそのパソコンに覚えておく。
 * 動かしたら、保存を待たずに行き先の位置で見せる（2026-11-11。保存に失敗したら元に戻して知らせる）。
 * 複数選ぶ（試作と同じ）：Ctrl か Shift を押しながら棒を押す／「複数選ぶ」を入れて押す と、選ぶ・外すになる。
 *   選んだ棒は上の帯の「−1日」「＋1日」「○日ずらす」で、全部同じだけ動かす（開始予定と納期の両方）。Esc か「選ぶのをやめる」で外す。
 *   動かす前に確かめる。
 * マウスで引っぱる（2026-11-11 川﨑部長の希望）：パソコンのマウスだけ、棒を左右に引っぱると1日単位で動く（右の端をつかむと納期だけ）。
 *   選んでいる棒の1本をつかむと、選んだ棒が全部一緒に動く。指（タッチ）とペンでは引っぱれない（指で誤って動かさないため。押すと日付の小窓）。
 *   引っぱった日数はカレンダーの日数（見えている升目どおり）。放すとすぐ保存し、「元に戻す」で戻せる。引っぱっている途中の Esc でやめる。
 * 元に戻す・やり直す（2026-11-11〜 画面を開いている間は何回でも）：保存した予定の変更を、新しい方から順に戻す・戻したものをもう一度する
 *   （ほかの人が間に変えていたら、サーバーが断り、その1回分は捨てる）。新しく動かすと、やり直すの方は消える。
 * 前の工程もずらす（2026-11-11〜 初めはオフ）：後ろの工程と同じ量で、同じ品目の前の工程（未完了のもの）もずらす。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
/** 元に戻す・やり直すの1回分（changes＝そのとき送る中身） */
type Step = { label: string; changes: Change[] };
const flip = (cs: Change[]): Change[] => cs.map((c) => ({ pid: c.pid, s: c.base.s, e: c.base.e, base: { s: c.s, e: c.e } }));
/** マウスで引っぱっている途中の様子（mode：move＝棒ごと／end＝納期だけ） */
type Drag = { pid: string; ids: string[]; mode: "move" | "end"; x0: number; k: number; moved: boolean; cx: number; cy: number; minK: number };

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

/** a から b まで何日動いたか（work なら土日・休日を数えない稼働日の数） */
function daysBetween(a: string, b: string, work: boolean, isOff: (d: string) => boolean): number {
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
}

type Hit = { it: BoardItem; p: BoardProc };
/** 同じ品目で、この工程より後ろの、まだ終わっていない予定の入った工程（出荷も入る。試作の gLater と同じ） */
const laterProcs = (it: BoardItem, p: BoardProc) => {
  const i = it.procs.findIndex((x) => x.id === p.id);
  return it.procs.slice(i + 1).filter((x) => !x.done_at && (x.plan_start || x.due));
};
/** 同じ品目で、この工程より前の、まだ終わっていない予定の入った工程（2026-11-11 前の工程もずらす） */
const earlierProcs = (it: BoardItem, p: BoardProc) => {
  const i = it.procs.findIndex((x) => x.id === p.id);
  return it.procs.slice(0, Math.max(i, 0)).filter((x) => !x.done_at && (x.plan_start || x.due));
};

/** 上の帯の印：後ろの工程もずらす（初めはオン）・前の工程もずらす（初めはオフ）・休日を数えない（初めはオン） */
type Opt = { cascade: boolean; back: boolean; work: boolean };

/**
 * 動かした棒の新しい予定から、送る中身を作る（試作の gPlanMany と同じ）。
 * 動かした棒はそのとおりに。cascade なら後ろの工程、back なら前の工程を、「納期の動き（納期が無ければ開始予定の動き）」だけずらす
 * （work なら稼働日の数に直してずらす）。同じ工程は1回だけ（選んだ棒・ほかの棒の前後で重なっても二重に動かさない）。
 * word は「と前1個・後ろ2個」のような、知らせに足す言葉。
 */
function planMany(
  list: (Hit & { ns: string; ne: string })[],
  { cascade, back, work }: Opt,
  isOff: (d: string) => boolean
): { changes: Change[]; front: number; later: number; word: string } {
  const map = new Map<string, Change>();
  const put = (q: BoardProc, s: string, e: string) => {
    if (!map.has(q.id)) map.set(q.id, { pid: q.id, s, e, base: { s: q.plan_start, e: q.due } });
  };
  list.forEach((x) => put(x.p, x.ns, x.ne));
  const fronts = new Set<string>();
  if (cascade || back) {
    [...list]
      .sort((x, y) => x.it.procs.findIndex((q) => q.id === x.p.id) - y.it.procs.findIndex((q) => q.id === y.p.id))
      .forEach((x) => {
        const o = (x.p.due || x.p.plan_start).slice(0, 10);
        const m = (x.p.due ? x.ne : x.ns).slice(0, 10);
        const k = daysBetween(o, m, work, isOff);
        if (!o || !m || !k) return;
        const mv = (q: BoardProc) => put(q, shiftDate(q.plan_start, k, work, isOff), shiftDate(q.due, k, work, isOff));
        if (back)
          earlierProcs(x.it, x.p).forEach((q) => {
            if (!map.has(q.id)) fronts.add(q.id);
            mv(q);
          });
        if (cascade) laterProcs(x.it, x.p).forEach(mv);
      });
  }
  const changes = [...map.values()].filter((c) => c.s !== c.base.s || c.e !== c.base.e);
  const others = changes.filter((c) => !list.some((x) => x.p.id === c.pid));
  const front = others.filter((c) => fronts.has(c.pid)).length;
  const later = others.length - front;
  const word = front || later ? `と${[front ? `前${front}個` : "", later ? `後ろ${later}個` : ""].filter(Boolean).join("・")}` : "";
  return { changes, front, later, word };
}

/** 上の帯の印を、そのパソコンに覚えておく */
const PREF_KEY = "kotei-gantt-pref";
const readPref = (): Opt => {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return { cascade: v.cascade !== false, back: v.back === true, work: v.work !== false };
  } catch {
    return { cascade: true, back: false, work: true };
  }
};

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
  /** 後ろの工程もずらす（初めはオン・試作と同じ）／前の工程もずらす（初めはオフ）／休日を数えない（稼働日でずらす） */
  // 最初の表示は「読み込み中…」だけなので、サーバーで作る画面と食い違わない
  const [opt, setOptRaw] = useState<Opt>(readPref);
  const { cascade, back, work } = opt;
  const setOpt = (v: Partial<Opt>) => {
    const n = { ...opt, ...v };
    setOptRaw(n);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(n));
    } catch {
      /* 覚えられなくても動く */
    }
  };
  /**
   * 元に戻す・やり直す（画面を開いている間は何回でも。古い方から捨てて50回まで）。中身は「その変更を逆に送るもの」。
   * 新しく動かすと、やり直すの方は消える。
   */
  const [undos, setUndos] = useState<Step[]>([]);
  const [redos, setRedos] = useState<Step[]>([]);
  const undo = undos[undos.length - 1] ?? null;
  const redo = redos[redos.length - 1] ?? null;
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** 引っぱり終わった直後の「押した」を無視する印（引っぱりを押したと取り違えないため） */
  const dragged = useRef(false);
  /** 引っぱりの最新の様子（マウスの動きをすぐ追うため、画面の状態とは別に持つ） */
  const dragRef = useRef<Drag | null>(null);

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

  /**
   * 予定の変更を送る。うまくいけば、逆に送る中身を「元に戻す」（戻したときは「やり直す」）に積む。
   * 送る前に、画面のデータを行き先の日付に書き換えて見せておく（保存を待つ間に棒が元の位置へ戻って見えないように）。
   * 保存に失敗したら、画面を元の予定に戻して知らせる。
   */
  const sendPlan = useCallback(
    async (changes: Change[], label: string, kind: "new" | "undo" | "redo" = "new"): Promise<boolean> => {
      if (!changes.length) return false;
      setBusy(true);
      const before = board; // 保存に失敗したとき元に戻すため
      if (before) {
        const m = new Map(changes.map((c) => [c.pid, c]));
        setBoard({
          ...before,
          items: before.items.map((it) =>
            it.procs.some((p) => m.has(p.id)) ? { ...it, procs: it.procs.map((p) => (m.has(p.id) ? { ...p, plan_start: m.get(p.id)!.s, due: m.get(p.id)!.e } : p)) } : it
          ),
        });
      }
      const putBack = () => {
        if (before) setBoard(before);
      };
      try {
        const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string; changed?: number };
        if (!r.ok) {
          putBack();
          // 戻す・やり直すが断られたら、その1回分は捨てる（間にほかの人が変えたので、もう同じには戻せない）
          if (kind === "undo") setUndos((u) => u.slice(0, -1));
          if (kind === "redo") setRedos((r) => r.slice(0, -1));
          setMsg({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません。元の予定に戻しました）", bad: true });
          await load();
          return false;
        }
        const step = { label, changes: flip(changes) };
        if (kind === "new") {
          setUndos((u) => [...u.slice(-49), step]);
          setRedos([]);
        } else if (kind === "undo") {
          setUndos((u) => u.slice(0, -1));
          setRedos((r) => [...r, step]);
        } else {
          setRedos((r) => r.slice(0, -1));
          setUndos((u) => [...u, step]);
        }
        setMsg({ text: `${kind === "undo" ? `元に戻しました：${label}` : kind === "redo" ? `やり直しました：${label}` : label}（${j.changed ?? 0}件）` });
        await load();
        return true;
      } catch {
        putBack();
        setMsg({ text: "つながりませんでした。何も保存されていません。元の予定に戻しました。", bad: true });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, board]
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
    const list = [...sel].map((id) => byPid.get(id)).filter((x): x is Hit => !!x);
    const { changes, word } = planMany(
      list.map((x) => ({ ...x, ns: shiftDate(x.p.plan_start, n, work, isOff), ne: shiftDate(x.p.due, n, work, isOff) })),
      opt,
      isOff
    );
    const head = list
      .slice(0, 5)
      .map(({ it, p }) => `・${it.mgmt_no} ${p.name}`)
      .join("\n");
    const days = `${n > 0 ? "+" : ""}${n}日${work ? "（稼働日）" : ""}`;
    const tail = word ? `\n${word.slice(1)}の工程も同じだけずらします。` : "";
    if (!confirm(`選んだ ${list.length}本 の開始予定と納期を ${days} ずらします。\n${head}${list.length > 5 ? `\nほか ${list.length - 5}本` : ""}${tail}\nよろしいですか？`)) return;
    const one = list.length === 1 ? `${list[0].it.mgmt_no} ${list[0].p.name}` : `${list.length}本まとめて`;
    await sendPlan(changes, `予定の変更 ${one}${word}（${days}）`);
  };

  /** 放したら保存する（カレンダーの日数で動かす） */
  const dropDrag = useCallback(
    async (d: Drag) => {
      if (!d.moved) return;
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      if (!d.k) return;
      const list = d.ids.map((id) => byPid.get(id)).filter((x): x is Hit => !!x);
      // 引っぱった棒はカレンダーの日数で動かす。後ろの工程は、納期の動きを（休日を数えないなら稼働日に直して）ずらす
      const { changes, word } = planMany(
        list.map((x) => ({ ...x, ns: d.mode === "move" ? shiftDate(x.p.plan_start, d.k, false, isOff) : x.p.plan_start, ne: shiftDate(x.p.due, d.k, false, isOff) })),
        opt,
        isOff
      );
      const one = list.length === 1 ? `${list[0].it.mgmt_no} ${list[0].p.name}` : `${list.length}本まとめて`;
      await sendPlan(changes, `予定の変更 ${one}${word}（引っぱって${d.mode === "end" ? "納期を" : ""}${d.k > 0 ? "+" : ""}${d.k}日）`);
    },
    [byPid, isOff, sendPlan, opt]
  );

  /** マウスで棒をつかむ（指・ペンでは何もしない＝押して小窓のまま） */
  const startDrag = (p: BoardProc, ev: React.PointerEvent<HTMLElement>) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0 || busy) return;
    ev.preventDefault();
    const mode = (ev.target as HTMLElement).dataset.edge ? "end" : "move";
    const ids = sel.has(p.id) ? [...sel] : [p.id];
    // 納期だけ動かすとき、開始予定より前にはしない（いちばん短い棒に合わせる）
    const minK =
      mode === "end"
        ? -Math.min(
            ...ids.map((id) => {
              const x = byPid.get(id)?.p;
              return x && x.plan_start && x.due ? Math.max(0, diffDays(x.plan_start.slice(0, 10), x.due.slice(0, 10))) : 0;
            })
          )
        : -Infinity;
    const first: Drag = { pid: p.id, ids, mode, x0: ev.clientX, k: 0, moved: false, cx: ev.clientX, cy: ev.clientY, minK };
    dragRef.current = first;
    setDrag(first);
    // つかんだその場で、画面のどこでマウスを動かしても追う（すばやく動かしても取りこぼさない）
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      const moved = d.moved || Math.abs(dx) > 4;
      const nd = { ...d, moved, k: moved ? Math.max(Math.round(dx / DAY_W), d.minK) : 0, cx: e.clientX, cy: e.clientY };
      dragRef.current = nd;
      setDrag(nd);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      dragRef.current = null;
      setDrag(null);
    };
    const up = (e: PointerEvent) => {
      move(e);
      const d = dragRef.current;
      stop();
      if (d) void dropDrag(d);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (dragRef.current?.moved) {
        dragged.current = true;
        setTimeout(() => (dragged.current = false), 0);
      }
      stop();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  };

  const doUndo = async () => {
    if (!undo) return;
    if (!confirm(`直前の変更（${undo.label}）を元に戻します。よろしいですか？`)) return;
    await sendPlan(undo.changes, undo.label, "undo");
  };
  const doRedo = async () => {
    if (!redo) return;
    if (!confirm(`元に戻した変更（${redo.label}）を、もう一度します。よろしいですか？`)) return;
    await sendPlan(redo.changes, redo.label, "redo");
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
            ↶ 元に戻す{undos.length > 1 ? `（${undos.length}）` : ""}
          </button>
          <button type="button" disabled={!redo || busy} onClick={doRedo} title={redo ? redo.label : ""} className={`${SUB} disabled:opacity-50`}>
            ↷ やり直す{redos.length > 1 ? `（${redos.length}）` : ""}
          </button>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={back} onChange={(e) => setOpt({ back: e.target.checked })} className="h-5 w-5" />
            前の工程もずらす
          </label>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={cascade} onChange={(e) => setOpt({ cascade: e.target.checked })} className="h-5 w-5" />
            後ろの工程もずらす
          </label>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={work} onChange={(e) => setOpt({ work: e.target.checked })} className="h-5 w-5" />
            休日を数えない（稼働日でずらす）
          </label>
          {(undo || redo) && (
            <span className="text-sm text-ink-sub">
              {undo ? `次に戻すのは：${undo.label}` : ""}
              {undo && redo ? "／" : ""}
              {redo ? `次にやり直すのは：${redo.label}` : ""}
            </span>
          )}
          {selMode && <span className="text-base">押した棒を選ぶ・外す（日付の小窓は開きません）</span>}
        </div>
      )}
      {admin && sel.size > 0 && (
        <div
          role="region"
          aria-label="選んだ棒をまとめて動かす"
          className="fixed inset-x-4 bottom-2 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg border-2 border-accent bg-white p-4 shadow-lg"
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
          <span className="text-sm text-ink-sub">
            {work ? "休日を数えない" : "カレンダーの日数"}
            {back ? "・前の工程もずらす" : ""}
            {cascade ? "・後ろの工程もずらす" : ""}
          </span>
          <button type="button" onClick={() => setSel(new Set())} className={SUB}>
            選ぶのをやめる（Esc）
          </button>
        </div>
      )}
      <p className="mt-2 text-sm text-ink-sub">
        棒＝開始予定〜納期。灰色の列は土日・休日。
        {admin
          ? "棒を押すと予定を直せます。パソコンのマウスなら棒を左右に引っぱっても動きます（右の端をつかむと納期だけ）。何本かまとめて動かすときは、Ctrl（か Shift）を押しながら押すか、「複数選ぶ」を入れて押します（前へは −3 のように入れます）。"
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
              drag={drag}
              onGrab={startDrag}
              onPick={(p, multi) => {
                if (dragged.current) return;
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

      {drag?.moved && (
        <div role="status" className="pointer-events-none fixed z-50 rounded border border-accent bg-white px-2 py-1 text-base font-bold shadow" style={{ left: drag.cx + 12, top: drag.cy + 14 }}>
          {drag.ids.length > 1 ? `${drag.ids.length}本まとめて ` : ""}
          {drag.mode === "end" ? "納期を" : ""}
          {drag.k > 0 ? "+" : ""}
          {drag.k}日{drag.k === 0 ? "（動かさない）" : ""}
        </div>
      )}

      {edit && (
        <EditBox
          it={edit.it}
          p={edit.p}
          isOff={isOff}
          opt={opt}
          setOpt={setOpt}
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
  drag,
  onGrab,
  onPick,
}: {
  it: BoardItem;
  days: string[];
  today: string;
  isOff: (d: string) => boolean;
  admin: boolean;
  sel: Set<string>;
  drag: Drag | null;
  onGrab: (p: BoardProc, ev: React.PointerEvent<HTMLElement>) => void;
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
          let left = Math.max(a, 0) * DAY_W;
          let w = (Math.min(b, days.length - 1) - Math.max(a, 0) + 1) * DAY_W;
          // 引っぱっている途中は、その日数ぶん動かして見せる
          const dragging = !!drag?.moved && drag.ids.includes(p.id);
          if (dragging && drag.mode === "move") left += drag.k * DAY_W;
          if (dragging && drag.mode === "end") w += drag.k * DAY_W;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!admin}
              aria-pressed={admin ? on : undefined}
              onPointerDown={admin ? (ev) => onGrab(p, ev) : undefined}
              onClick={(ev) => onPick(p, ev.ctrlKey || ev.metaKey || ev.shiftKey)}
              title={`${p.name}\n開始予定 ${p.plan_start || "－"}\n納期 ${p.due || "－"}${p.done_at ? `\n完了 ${p.done_at}` : ""}`}
              className={`absolute flex items-center overflow-hidden rounded border px-1 text-left text-sm whitespace-nowrap ${cls} ${on ? "outline outline-4 outline-accent" : ""} ${dragging ? "z-10 opacity-80 shadow-lg" : ""} ${admin ? "cursor-grab select-none" : "cursor-default"}`}
              style={{ top: 4 + k * 40, left, width: Math.max(w, DAY_W), height: 36 }}
            >
              {on && <span className="mr-1 font-bold text-accent">✓選</span>}
              {st && <span className="mr-1">{st}</span>}
              {p.in_out === "外注" && <span className="mr-1">外注</span>}
              {p.name}
              {admin && <span data-edge="1" aria-hidden className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize" />}
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
  opt,
  setOpt,
  onClose,
  busy,
  onSave,
}: {
  it: BoardItem;
  p: BoardProc;
  isOff: (d: string) => boolean;
  opt: Opt;
  setOpt: (v: Partial<Opt>) => void;
  onClose: () => void;
  busy: boolean;
  onSave: (changes: Change[], label: string) => void;
}) {
  const [s, setS] = useState(p.plan_start);
  const [e, setE] = useState(p.due);
  const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
  const { cascade, back, work } = opt;
  const after = laterProcs(it, p);
  const before = earlierProcs(it, p);

  const save = () => {
    const ns = s.trim();
    const ne = e.trim();
    const { changes, word } = planMany([{ it, p, ns, ne }], opt, isOff);
    // 日付を変えていなくても、空白を消したなどで送るものがあれば送る（無ければ閉じるだけ）
    if (!changes.length) return onClose();
    const n = daysBetween((p.due || p.plan_start).slice(0, 10), (p.due ? ne : ns).slice(0, 10), work, isOff);
    if (word && !confirm(`${p.name}と、${word.slice(1)}の工程を ${n > 0 ? "+" : ""}${n}日${work ? "（稼働日）" : ""}ずらします。よろしいですか？`)) return;
    onSave(changes, `予定の変更 ${it.mgmt_no} ${p.name}${word}`);
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
      {(after.length > 0 || before.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {before.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input type="checkbox" checked={back} onChange={(ev) => setOpt({ back: ev.target.checked })} className="h-5 w-5" />
              前の工程（{before.length}個）も同じだけずらす
            </label>
          )}
          {after.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input type="checkbox" checked={cascade} onChange={(ev) => setOpt({ cascade: ev.target.checked })} className="h-5 w-5" />
              後ろの工程（{after.length}個）も同じだけずらす
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" checked={work} onChange={(ev) => setOpt({ work: ev.target.checked })} className="h-5 w-5" />
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
