"use client";

/**
 * ボード（今の工程ごとのレーン）。カードの動かし方は SBC加工予定ボード（kakou-yotei-app の Board.tsx）と同じ：
 *   - レーンが縦に並び、各レーンにカード（品目）が横に並ぶ。左から順が加工順
 *   - 「カード編集：オン」のときだけ、カードを掴んで動かせる（オフの間はうっかり動かない）。指は長押しで掴む
 *   - 別のレーンへ移す／同じレーンの中で並べ替える。カードを押すと小窓が開き、「移動先の工程を選ぶ」でも移せる
 *   - ドラッグ中・小窓を開いている間は、自動の読み直しを止める
 *   - レーンの左に「納期順に並替」（確認が出る）と、並べ替えた直後だけ「↩ 戻す」（管理者だけ）
 *   - カードに工程の並び（L1⇒L2⇒MC…）を出し、今の工程だけ目立たせる（加工予定ボードは赤字。ここは強調色の青の太字）
 * 工程管理では、レーン＝今の工程（工程名）。カードを後ろの工程のレーンへ移すと、その手前までの工程を完了にして進める。
 * 前の工程のレーンへ移すと、その工程から今の工程の手前までの完了を取り消す。どちらも確かめてから送る。
 * 同じレーンの中の並べ替えは加工順として残す（管理者だけ）。出荷の工程をまたぐ移動はしない（出荷は小窓で数・伝票を入れる）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, BoardItem, BoardProc } from "@/lib/kotei/board";
import type { Act } from "@/lib/kotei/acts";
import { isItemDone, stockRole } from "@/lib/kotei/rules";
import { todayJst } from "@/lib/kotei/time";
import ProcPanel from "@/components/board/ProcPanel";
import { loadPick, postActs } from "@/components/board/postActs";

type Me = { name: string; named: boolean; admin: boolean };
type BoardRes = Board & { me: Me };
interface Card {
  it: BoardItem;
  cur: BoardProc;
}
type LaneMap = Map<string, Card[]>; // 工程名 -> カード（左から加工順）

const COMPACT_KEY = "koutei:lane-compact";

function curOf(it: BoardItem): BoardProc | null {
  return isItemDone(it.kubun, it.procs) ? null : (it.procs.find((p) => !p.done_at) ?? null);
}

/** 今あるデータからレーンを組む。レーンの並び＝その工程名が工程の並びの中で出てくる位置の真ん中（だいたいの流れの順） */
function buildLanes(b: BoardRes, q: string): { order: string[]; map: LaneMap } {
  const k = q.trim().toLowerCase();
  const pos: Record<string, number[]> = {};
  const map: LaneMap = new Map();
  b.items.forEach((it) => {
    if (it.hidden === "1" || it.case_hidden === "1") return;
    const cur = curOf(it);
    if (!cur) return;
    it.procs.forEach((p, i) => (pos[p.name] ||= []).push(i / Math.max(1, it.procs.length - 1)));
    if (k && ![it.mgmt_no, it.drawing_no, it.name, it.customer, it.barcode].join(" ").toLowerCase().includes(k)) return;
    const l = map.get(cur.name) ?? [];
    l.push({ it, cur });
    map.set(cur.name, l);
  });
  const med = (a: number[]) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)] ?? 1;
  };
  const order = Object.keys(pos).sort((a, c) => med(pos[a]) - med(pos[c]) || a.localeCompare(c, "ja"));
  order.forEach((n) => {
    const l = map.get(n) ?? [];
    l.sort((a, c) => {
      const x = a.cur.lane_order ?? Infinity;
      const y = c.cur.lane_order ?? Infinity;
      return x - y || (a.it.final_due || "9999").localeCompare(c.it.final_due || "9999") || a.it.mgmt_no.localeCompare(c.it.mgmt_no, "ja");
    });
    map.set(n, l);
  });
  return { order, map };
}

/** カードを工程名 target のレーンへ移すための操作（進める＝完了／戻す＝完了の取り消し）。できないときは error */
function moveActs(it: BoardItem, target: string): { acts: Act[]; text: string } | { error: string } {
  const cur = curOf(it);
  if (!cur) return { error: "この品目は全部終わっています" };
  const i = it.procs.findIndex((p) => p.id === cur.id);
  const shipId = stockRole(it.kubun, it.procs)?.ship;
  const j = it.procs.findIndex((p, n) => n > i && p.name === target && !p.done_at);
  if (j > i) {
    const steps = it.procs.slice(i, j).filter((p) => !p.done_at);
    const ship = steps.find((p) => p.id === shipId);
    if (ship) return { error: `出荷の工程（${ship.name}）をまたぐので、ここでは動かせません。カードを押して、出荷の数や伝票番号を入れて記録してください` };
    return {
      acts: steps.map((p) => ({ op: "done", pid: p.id, qty: p.done_qty || it.qty || "0", ng: p.defect_qty, why: p.defect_reason })),
      text: `${steps.map((p) => p.name).join("・")} を完了にして、「${target}」へ進めます（数は品目の数量 ${it.qty || 0}）。`,
    };
  }
  let back = -1;
  it.procs.forEach((p, n) => {
    if (n < i && p.name === target) back = n;
  });
  if (back >= 0) {
    const steps = it.procs
      .slice(back, i)
      .filter((p) => p.done_at)
      .reverse();
    if (steps.some((p) => p.id === shipId)) return { error: "出荷の工程の完了は、カードを押して小窓から取り消してください" };
    return {
      acts: steps.map((p) => ({ op: "undoDone", pid: p.id, base: { s: p.started_at, e: p.done_at } })),
      text: `${steps.map((p) => p.name).join("・")} の完了を取り消して、「${target}」へ戻します。`,
    };
  }
  return { error: `この品目の工程に「${target}」はありません（工程の並びは案件の画面で直せます）` };
}

export default function LaneBoard() {
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [q, setQ] = useState("");
  const [laneMap, setLaneMapState] = useState<LaneMap>(new Map());
  const laneRef = useRef<LaneMap>(new Map());
  const setLanes = (m: LaneMap) => {
    laneRef.current = m;
    setLaneMapState(m);
  };
  const [order, setOrder] = useState<string[]>([]);
  const [active, setActive] = useState<Card | null>(null);
  const [open, setOpen] = useState<Card | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [compact, setCompactState] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // dnd-kit はSSRと初回描画で属性が食い違うため、マウント後にだけ有効化する（加工予定ボードと同じ）
  const [mounted, setMounted] = useState(false);
  const fromLane = useRef<string | null>(null);
  // 「↩ 戻す」用：レーンごとに、直前の並べ替えの前の順番（この画面を開いている間だけ覚える）
  const [lastSort, setLastSort] = useState<Record<string, string[]>>({});

  const apply = useCallback((b: BoardRes, query: string) => {
    const l = buildLanes(b, query);
    laneRef.current = l.map;
    setLaneMapState(l.map);
    setOrder(l.order);
  }, []);
  const load = useCallback(
    (query: string) =>
      fetch("/api/board", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          setBoard(j as BoardRes);
          apply(j as BoardRes, query);
          setMounted(true);
        })
        .catch(() => setMsg({ text: "読み込めませんでした。", bad: true })),
    [apply]
  );
  useEffect(() => {
    load("");
  }, [load]);

  // 1分ごとに更新番号だけ確かめて、変わっていたら読み直す。ドラッグ中・小窓を開いている間は止める（加工予定ボードと同じ）
  const ver = board?.ver;
  useEffect(() => {
    if (!ver || active || open) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/board?ver=${encodeURIComponent(ver)}`, { cache: "no-store" });
        const j = (await r.json()) as BoardRes | { same: true };
        if (!("same" in j)) {
          setBoard(j);
          apply(j, q);
        }
      } catch {
        // 次の回にまた確かめる
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [ver, active, open, q, apply]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const total = useMemo(() => [...laneMap.values()].reduce((s, l) => s + l.length, 0), [laneMap]);

  if (!board) return <p className="py-8 text-base text-ink-sub">{msg?.text || "読み込み中…"}</p>;
  const me = board.me;
  const pick = loadPick();
  const worker = me.named ? me.name : pick;

  const findLane = (id: string): string | null => {
    for (const [name, cards] of laneRef.current) if (cards.some((c) => c.cur.id === id)) return name;
    return null;
  };
  const laneOf = (overId: string | number): string | null => {
    const s = String(overId);
    return s.startsWith("lane:") ? s.slice(5) : findLane(s);
  };

  const send = async (acts: Act[], doneMsg: string) => {
    if (!worker) {
      setMsg({ text: "工程一覧の画面の上で、作業者を選んでから動かしてください。", bad: true });
      return false;
    }
    setBusy(true);
    const r = await postActs(acts, me.named ? undefined : pick, doneMsg);
    setMsg({ text: r.text, bad: !r.ok });
    await load(q);
    setBusy(false);
    return r.ok;
  };

  /** カードを target のレーンへ移す（確かめてから） */
  const moveTo = async (card: Card, target: string) => {
    const m = moveActs(card.it, target);
    if ("error" in m) {
      setMsg({ text: m.error, bad: true });
      apply(board, q); // 見た目を元に戻す
      return false;
    }
    if (!confirm(`${card.it.mgmt_no} ${card.it.drawing_no}\n${m.text}\nよろしいですか？`)) {
      apply(board, q);
      return false;
    }
    return send(m.acts, `「${target}」へ移しました`);
  };

  const saveOrder = async (lane: string, cards: Card[]) => {
    const r = await fetch("/api/board/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane, pids: cards.map((c) => c.cur.id) }),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg({ text: j.error || "並べ替えを保存できませんでした", bad: true });
      await load(q);
    } else setMsg({ text: `「${lane}」の加工順を保存しました` });
  };

  /** 「納期順に並替」：そのレーンのカードを最終納期の早い順に（納期が無いものは今の順番のまま後ろ）。加工予定ボードと同じ確認を出す */
  const sortByDue = async (lane: string) => {
    const cards = [...(laneRef.current.get(lane) ?? [])];
    if (cards.length < 2) return setMsg({ text: `「${lane}」はカードが${cards.length}枚なので並び替えるものがありません。` });
    if (
      !confirm(
        `「${lane}」のカード ${cards.length} 枚を、最終納期の早い順に並び替えます。\n\n・納期が空のカードは、今の順番のまま後ろに置きます\n・間違えて押したときは、同じ場所に出る「↩ 戻す」ボタンで並び替え前に戻せます\n\n並び替えてよろしいですか？`
      )
    )
      return;
    const before = cards.map((c) => c.cur.id);
    const sorted = cards
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const x = a.c.it.final_due || "";
        const y = b.c.it.final_due || "";
        if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1) || a.i - b.i;
        return x.localeCompare(y) || a.i - b.i;
      })
      .map((x) => x.c);
    const next = new Map(laneRef.current);
    next.set(lane, sorted);
    setLanes(next);
    setLastSort({ ...lastSort, [lane]: before });
    await saveOrder(lane, sorted);
  };
  /** 「↩ 戻す」：直前の並べ替えの前の順番に戻す（そのあと動いたカードは今の場所のまま、残りを元の順に） */
  const undoSort = async (lane: string) => {
    const before = lastSort[lane];
    if (!before || !confirm(`「${lane}」の並び替えを取り消して、前の順番に戻します。よろしいですか？`)) return;
    const cards = [...(laneRef.current.get(lane) ?? [])];
    const pos = new Map(before.map((id, i) => [id, i]));
    const back = cards.slice().sort((a, b) => (pos.get(a.cur.id) ?? 1e9) - (pos.get(b.cur.id) ?? 1e9));
    const next = new Map(laneRef.current);
    next.set(lane, back);
    setLanes(next);
    const rest = { ...lastSort };
    delete rest[lane];
    setLastSort(rest);
    await saveOrder(lane, back);
  };

  function onStart(e: DragStartEvent) {
    const lane = findLane(String(e.active.id));
    fromLane.current = lane;
    setActive(lane ? (laneRef.current.get(lane)?.find((c) => c.cur.id === String(e.active.id)) ?? null) : null);
  }
  function onOver(e: DragOverEvent) {
    const { active: a, over } = e;
    if (!over) return;
    const from = findLane(String(a.id));
    const to = laneOf(over.id);
    if (!from || !to || from === to) return;
    // 別のレーンに入った時点で見た目だけ移す（加工予定ボードと同じ）
    const next = new Map(laneRef.current);
    const fc = [...(next.get(from) ?? [])];
    const tc = [...(next.get(to) ?? [])];
    const idx = fc.findIndex((c) => c.cur.id === String(a.id));
    if (idx < 0) return;
    const [moved] = fc.splice(idx, 1);
    const oi = String(over.id).startsWith("lane:") ? -1 : tc.findIndex((c) => c.cur.id === String(over.id));
    if (oi >= 0) tc.splice(oi, 0, moved);
    else tc.push(moved);
    next.set(from, fc);
    next.set(to, tc);
    setLanes(next);
  }
  async function onEnd(e: DragEndEvent) {
    const { active: a, over } = e;
    const card = active;
    setActive(null);
    const from = fromLane.current;
    fromLane.current = null;
    if (!over || !card || !from) return apply(board!, q);
    const to = laneOf(over.id);
    if (!to) return apply(board!, q);
    if (to !== from) {
      await moveTo(card, to);
      return;
    }
    // 同じレーンの中の並べ替え＝加工順（管理者だけ）
    if (!me.admin) {
      setMsg({ text: "加工順を並べ替えられるのは管理者だけです", bad: true });
      return apply(board!, q);
    }
    const cards = [...(laneRef.current.get(to) ?? [])];
    const fi = cards.findIndex((c) => c.cur.id === String(a.id));
    let ti = String(over.id).startsWith("lane:") ? cards.length - 1 : cards.findIndex((c) => c.cur.id === String(over.id));
    if (fi < 0) return;
    if (ti < 0) ti = cards.length - 1;
    if (fi === ti) return;
    setLastSort({ ...lastSort, [to]: cards.map((c) => c.cur.id) });
    const [m] = cards.splice(fi, 1);
    cards.splice(ti, 0, m);
    const next = new Map(laneRef.current);
    next.set(to, cards);
    setLanes(next);
    await saveOrder(to, cards);
  }

  const setCompact = (v: boolean) => {
    setCompactState(v);
    try {
      localStorage.setItem(COMPACT_KEY, v ? "1" : "0");
    } catch {
      // 覚えられなくても動く
    }
  };
  const today = todayJst();
  const BTN = "min-h-11 rounded-lg px-4 text-base font-bold";

  return (
    <div>
      <h1 className="text-2xl font-bold">ボード（今の工程ごと）</h1>
      <p className="mt-2 text-sm text-ink-sub">
        1行＝今の工程。カードは左から加工順。「カード編集：オン」にすると、カードを掴んで別の工程へ移せます（後ろへ＝完了にして進める／前へ＝完了を取り消して戻す）。同じ行の中で並べ替えると加工順になります（管理者だけ）。指で動かすときは長押ししてから動かします。
      </p>
      {msg && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-2xl items-start gap-4 rounded-lg border-2 bg-white p-4 text-base shadow-lg ${msg.bad ? "border-danger text-danger" : "border-ok"}`}
        >
          <p className="whitespace-pre-wrap">{msg.text}</p>
          <button type="button" onClick={() => setMsg(null)} className="ml-auto min-h-11 rounded-lg border border-line px-4 text-base text-ink">
            閉じる
          </button>
        </div>
      )}
      <div className="sticky top-0 z-20 mt-4 flex flex-wrap items-end gap-4 rounded-lg bg-card p-4">
        <button
          type="button"
          onClick={() => setEditMode(!editMode)}
          aria-pressed={editMode}
          title={editMode ? "カードを動かせないように戻します" : "カードをドラッグで動かせるようにします"}
          className={`${BTN} ${editMode ? "bg-accent text-white" : "border border-accent bg-white text-accent"}`}
        >
          {editMode ? "✏️ カード編集：オン" : "🔒 カード編集：オフ"}
        </button>
        <button
          type="button"
          onClick={() => setCompact(!compact)}
          aria-pressed={compact}
          title="カードを小さくして、管理番号・図面番号・数量・納期・工程の並びだけを表示します"
          className={`${BTN} ${compact ? "bg-accent text-white" : "border border-accent bg-white text-accent"}`}
        >
          {compact ? "▪ カードを小さく：オン" : "▫ カードを小さく"}
        </button>
        <label className="flex flex-col gap-2 text-sm">
          さがす（管理番号・図面番号・品名・顧客）
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              apply(board, e.target.value);
            }}
            className="min-h-11 w-64 rounded border border-ink-sub bg-white px-2 text-base"
          />
        </label>
        <p className="text-base">
          {total}件・作業者：<b>{worker || "（工程一覧で選んでください）"}</b>
        </p>
        <button type="button" disabled={busy} onClick={() => load(q)} className={`${BTN} ml-auto border border-accent bg-white text-accent`}>
          最新にする
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => (setActive(null), apply(board, q))}>
        <div className="mt-4 rounded-lg border border-line">
          {order.map((name) => (
            <Lane
              key={name}
              name={name}
              cards={laneMap.get(name) ?? []}
              canDrag={mounted && editMode && !busy}
              compact={compact}
              today={today}
              onOpen={(c) => setOpen(c)}
              admin={me.admin}
              busy={busy}
              canUndo={!!lastSort[name]}
              onSort={() => sortByDue(name)}
              onUndo={() => undoSort(name)}
            />
          ))}
        </div>
        <DragOverlay>{active ? <CardView card={active} compact={compact} today={today} overlay /> : null}</DragOverlay>
      </DndContext>

      {open && (
        <div role="dialog" aria-label="カードの詳しい中身" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="mt-8 w-full max-w-5xl rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-end gap-4 border-b border-line p-4">
              <div className="min-w-0">
                <p className="text-xl font-bold">{open.it.mgmt_no}</p>
                <p className="text-base">
                  {open.it.drawing_no} {open.it.name}・{open.it.customer}・{open.it.qty}個
                </p>
              </div>
              <label className="ml-auto flex flex-col gap-2 text-sm">
                移動先の工程を選ぶ
                <select
                  value=""
                  disabled={busy}
                  onChange={async (e) => {
                    const t = e.target.value;
                    if (t && (await moveTo(open, t))) setOpen(null);
                  }}
                  className="min-h-11 rounded border border-ink-sub bg-white px-2 text-base"
                >
                  <option value="">移動先の工程を選ぶ…</option>
                  {[...new Set(open.it.procs.filter((p) => p.id !== open.cur.id).map((p) => p.name))].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <ProcPanel
              it={open.it}
              p={open.cur}
              me={me}
              worker={worker}
              lists={board.lists}
              send={async (acts, m) => {
                const ok = await send(acts, m);
                if (ok) setOpen(null);
                return ok;
              }}
              onClose={() => setOpen(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Lane({
  name,
  cards,
  canDrag,
  compact,
  today,
  onOpen,
  admin,
  busy,
  canUndo,
  onSort,
  onUndo,
}: {
  name: string;
  cards: Card[];
  canDrag: boolean;
  compact: boolean;
  today: string;
  onOpen: (c: Card) => void;
  admin: boolean;
  busy: boolean;
  canUndo: boolean;
  onSort: () => void;
  onUndo: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${name}` });
  return (
    <div className={`flex min-h-[88px] border-b border-line last:border-b-0 ${isOver ? "bg-[#EAF1FB]" : ""}`}>
      <div className="flex w-36 shrink-0 flex-col justify-center border-r border-line bg-card px-2 py-2">
        <p className="text-base font-bold">{name}</p>
        <p className="text-sm text-ink-sub">{cards.length}件</p>
        {admin && cards.length > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={onSort}
            title={`「${name}」のカードを最終納期の早い順に並び替えます（確認が出ます）`}
            className="mt-2 min-h-11 rounded-lg border border-accent bg-white px-2 text-sm font-bold text-accent disabled:opacity-50"
          >
            納期順に並替
          </button>
        )}
        {admin && canUndo && (
          <button
            type="button"
            disabled={busy}
            onClick={onUndo}
            title="直前の並び替えを取り消して、前の順番に戻します（確認が出ます）"
            className="mt-2 min-h-11 rounded-lg border border-ink bg-warn-bg px-2 text-sm font-bold text-ink disabled:opacity-50"
          >
            ↩ 戻す
          </button>
        )}
      </div>
      <div ref={setNodeRef} className="min-w-0 flex-1 overflow-x-auto">
        <SortableContext items={cards.map((c) => c.cur.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex min-h-[88px] min-w-max items-stretch gap-2 p-2">
            {cards.length === 0 && <p className="self-center px-2 text-sm text-ink-sub">（ここへ移せます）</p>}
            {cards.map((c) => (
              <SortableCard key={c.cur.id} card={c} canDrag={canDrag} compact={compact} today={today} onOpen={onOpen} />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

function SortableCard({ card, canDrag, compact, today, onOpen }: { card: Card; canDrag: boolean; compact: boolean; today: string; onOpen: (c: Card) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.cur.id, disabled: !canDrag });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className={canDrag ? "cursor-grab touch-none" : ""}
    >
      <CardView card={card} compact={compact} today={today} onOpen={() => onOpen(card)} />
    </div>
  );
}

function CardView({ card, compact, today, onOpen, overlay }: { card: Card; compact: boolean; today: string; onOpen?: () => void; overlay?: boolean }) {
  const { it, cur } = card;
  const late = !!it.final_due && it.final_due.slice(0, 10) < today;
  const doing = !!cur.started_at;
  const sub = cur.machine || (cur.assignee && cur.assignee !== "-" ? cur.assignee : "");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full flex-col items-start gap-1 rounded-lg border bg-white p-2 text-left ${compact ? "w-40" : "w-60"} ${
        doing ? "border-2 border-[#B08A00] bg-warn-bg" : "border-line"
      } ${late ? "border-l-8 border-l-danger" : ""} ${overlay ? "shadow-lg" : ""}`}
    >
      <span className="flex w-full items-center gap-1">
        <b className="truncate text-base">{it.mgmt_no}</b>
        {doing && <span className="ml-auto shrink-0 rounded border border-[#B08A00] px-1 text-sm font-bold">中</span>}
      </span>
      <span className="w-full truncate text-sm">
        {it.drawing_no} {compact ? "" : it.name}
      </span>
      <span className="text-sm">
        {it.qty ? `${it.qty}個` : ""}
        {it.final_due && (
          <span className={late ? "ml-1 font-bold text-danger" : "ml-1"}>
            納期 {it.final_due.slice(5, 10)}
            {late ? "（遅れ）" : ""}
          </span>
        )}
      </span>
      <span className="text-sm leading-tight break-all">
        {it.procs.map((p, n) => (
          <span key={p.id}>
            {n > 0 && <span className="text-ink-sub">⇒</span>}
            <span className={p.id === cur.id ? "font-bold text-accent underline" : p.done_at ? "text-ink-sub" : ""}>{p.name}</span>
          </span>
        ))}
      </span>
      {!compact && (
        <>
          {(sub || cur.in_out === "外注") && (
            <span className="text-sm text-ink-sub">
              {cur.in_out === "外注" && "外注 "}
              {sub}
            </span>
          )}
          {cur.working.length > 0 && <span className="text-sm font-bold">作業中{cur.working.length}人</span>}
        </>
      )}
    </button>
  );
}
