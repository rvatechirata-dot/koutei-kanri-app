"use client";

/**
 * 基本の一覧（名寄せ）と休日の画面（4段目・管理者だけ）。
 * エムネットでは「MC-1」と「MC1」、「目視、梱包」と「目視梱包」のように、同じものが別の書き方で入っている。ここで1つにまとめる。
 * まとめると、今ある案件・工程の名前も残した名前に書き換わり、毎日のCSV取り込みでもそろえてから比べる（試作の6段目と同じ）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MasterList, MasterPut } from "@/lib/kotei/masters";
import { aliasList, masterMap, MASTER_KINDS, NOQTY } from "@/lib/kotei/rules";
import type { MasterRow } from "@/lib/kotei/types";

type Kind = (typeof MASTER_KINDS)[number];
type Row = MasterRow & { mark: string };
/** 一覧の1行（一覧にある名前か、データに出てくるが一覧に無い名前） */
interface Entry {
  key: string;
  name: string;
  row: Row | null;
  used: number;
}

const BTN = "min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50";
const MAIN = `${BTN} bg-accent text-white`;
const SUB = `${BTN} border border-accent bg-white text-accent`;
const DANGER = `${BTN} border border-danger bg-white text-danger`;
const INPUT = "min-h-11 rounded border border-ink-sub bg-white px-2 text-base";
const newId = () => "Kw" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const COMMON_REASONS = ["寸法不良", "キズ・打痕", "バリ", "面粗さ", "形状不良", "加工ミス", "材料不良", "工具の欠け・摩耗", "測定ミス", "その他"];

/** 似た書き方を見分ける鍵（全角→半角・大文字→小文字・空白や「-」「、」などの記号を取る） */
function simKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-ー－―_・、，,.。/／()（）]/g, "");
}

export default function MasterView() {
  const [data, setData] = useState<MasterList | null>(null);
  const [kind, setKind] = useState<Kind | "休日">("工程名");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [q, setQ] = useState("");

  const show = useCallback(
    (p: Promise<Response>) =>
      p
        .then((r) => r.json())
        .then((j) => setData(j as MasterList))
        .catch(() => setMsg({ text: "読み込めませんでした。", bad: true })),
    []
  );
  useEffect(() => {
    show(fetch("/api/masters", { cache: "no-store" }));
  }, [show]);

  const entriesBy = useMemo(() => {
    const out: Record<string, Entry[]> = {};
    if (!data) return out;
    const map = masterMap(data.rows);
    MASTER_KINDS.forEach((k) => {
      const used = data.used[k] ?? {};
      const list: Entry[] = data.rows
        .filter((r) => r.kind === k)
        .map((r) => ({
          key: "r:" + r.id,
          name: r.name,
          row: r,
          used: [r.name, ...aliasList(r.aliases)].reduce((s, n) => s + (used[n] || 0), 0),
        }));
      Object.entries(used).forEach(([n, c]) => {
        if (!map[k]?.[n]) list.push({ key: "n:" + n, name: n, row: null, used: c });
      });
      out[k] = list.sort((a, b) => (a.row && b.row ? Number(a.row.sort_order || 0) - Number(b.row.sort_order || 0) : 0) || a.name.localeCompare(b.name, "ja", { numeric: true }));
    });
    return out;
  }, [data]);

  if (!data) return <p className="py-8 text-base text-ink-sub">{msg?.text || "読み込み中…"}</p>;

  const post = async (body: unknown, done: (j: Record<string, number>) => string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/masters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as Record<string, number> & { error?: string };
      if (!r.ok) {
        setMsg({ text: (j.error || `保存できませんでした（${r.status}）`) + "（何も保存されていません）", bad: true });
        return false;
      }
      setMsg({ text: done(j) });
      setSel(new Set());
      setKeep("");
      setEdit(null);
      await show(fetch("/api/masters", { cache: "no-store" }));
      return true;
    } finally {
      setBusy(false);
    }
  };
  const doneText = (j: Record<string, number>) => `保存しました（書き換え：工程 ${j.procs ?? 0}行・案件 ${j.cases ?? 0}行）`;

  /** members をまとめて、名前 target の1行にする */
  const merge = (k: Kind, members: Entry[], target: string, note: string) => {
    const tEntry = members.find((m) => m.name === target && m.row) ?? (entriesBy[k] ?? []).find((m) => m.name === target && m.row);
    const base = tEntry?.row ?? null;
    const others = members.filter((m) => m !== tEntry && m.name !== target);
    const aliases = new Set([...(base ? aliasList(base.aliases) : [])]);
    others.forEach((m) => {
      aliases.add(m.name);
      if (m.row) aliasList(m.row.aliases).forEach((a) => aliases.add(a));
    });
    aliases.delete(target);
    const warn = k === "工程名" && members.some((m) => NOQTY.includes(m.name) !== NOQTY.includes(target) || /出荷/.test(m.name) !== /出荷/.test(target));
    if (
      !confirm(
        `「${others.map((m) => m.name).join("」「")}」を「${target}」にまとめます。\n今ある案件・工程の名前も「${target}」に書き換わります。${warn ? "\n※ 在庫の計算で扱いの違う工程名（材料発注・出荷 など）がまざっています。在庫の数や出荷の工程が変わることがあります。" : ""}\nよろしいですか？`
      )
    )
      return;
    const put: MasterPut = {
      id: base?.id ?? newId(),
      isNew: !base,
      base: base?.mark ?? "",
      f: { kind: k, name: target, aliases: [...aliases].join("｜"), sort_order: base?.sort_order ?? "", unused: base?.unused ?? "", memo: base?.memo ?? "" },
    };
    const del = others.filter((m) => m.row && m.row.id !== put.id).map((m) => ({ id: m.row!.id, base: m.row!.mark }));
    post({ kind: "save", put: [put], del, note }, doneText);
  };

  const tabs = (
    <div className="mt-4 flex flex-wrap gap-2">
      {[...MASTER_KINDS, "休日" as const].map((k) => {
        const list = k === "休日" ? [] : entriesBy[k] ?? [];
        const none = list.filter((e) => !e.row).length;
        const on = kind === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setSel(new Set());
              setEdit(null);
            }}
            aria-pressed={on}
            className={`min-h-11 rounded-lg border px-4 text-base ${on ? "border-accent bg-accent font-bold text-white" : "border-accent bg-white text-accent"}`}
          >
            {k}
            {k === "休日" ? `（${data.holidays.length}）` : `（${list.length - none}）`}
            {none > 0 && <span className={`ml-2 rounded px-1 text-sm ${on ? "bg-white text-ink" : "bg-warn-bg text-ink"}`}>無 {none}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold">基本の一覧（名寄せ）</h1>
      <p className="mt-2 text-base">
        同じものが別の書き方で入っているとき（例：「MC-1」と「MC1」）、1つにまとめます。まとめると、今ある案件・工程の名前も残した名前に書き換わり、毎日のCSV取り込みでもそろえてから比べます。エムネットの中身は変わりません。
      </p>
      {msg && (
        <p role="status" className={`mt-2 whitespace-pre-wrap rounded border bg-white p-2 text-base ${msg.bad ? "border-danger text-danger" : "border-ok"}`}>
          {msg.text}
        </p>
      )}
      {tabs}
      {kind === "休日" ? (
        <Holidays list={data.holidays} busy={busy} post={post} />
      ) : (
        <KindView
          kind={kind}
          entries={entriesBy[kind] ?? []}
          q={q}
          setQ={setQ}
          sel={sel}
          setSel={setSel}
          keep={keep}
          setKeep={setKeep}
          edit={edit}
          setEdit={setEdit}
          busy={busy}
          merge={merge}
          post={post}
          doneText={doneText}
        />
      )}
    </div>
  );
}

function KindView({
  kind,
  entries,
  q,
  setQ,
  sel,
  setSel,
  keep,
  setKeep,
  edit,
  setEdit,
  busy,
  merge,
  post,
  doneText,
}: {
  kind: Kind;
  entries: Entry[];
  q: string;
  setQ: (v: string) => void;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  keep: string;
  setKeep: (v: string) => void;
  edit: string | null;
  setEdit: (v: string | null) => void;
  busy: boolean;
  merge: (k: Kind, members: Entry[], target: string, note: string) => void;
  post: (body: unknown, done: (j: Record<string, number>) => string) => Promise<boolean>;
  doneText: (j: Record<string, number>) => string;
}) {
  // まとめる候補：似た書き方の組（全角半角・大文字小文字・記号の違いだけのもの）
  const groups = useMemo(() => {
    const by: Record<string, Entry[]> = {};
    entries.forEach((e) => (by[simKey(e.name)] ||= []).push(e));
    return Object.values(by).filter((g) => g.length > 1);
  }, [entries]);
  const k = q.trim().toLowerCase();
  const shown = entries.filter((e) => !k || e.name.toLowerCase().includes(k) || (e.row && e.row.aliases.toLowerCase().includes(k)));
  const picked = entries.filter((e) => sel.has(e.key));
  const none = entries.filter((e) => !e.row);
  const [nf, setNf] = useState({ name: "", aliases: "" });

  return (
    <div className="mt-4">
      {groups.length > 0 && (
        <section className="rounded-lg bg-card p-4">
          <h2 className="text-xl font-bold">まとめる候補（似た書き方）{groups.length}組</h2>
          <div className="mt-2 flex flex-col gap-2">
            {groups.slice(0, 50).map((g) => (
              <div key={g.map((e) => e.key).join("+")} className="flex flex-wrap items-center gap-2 rounded border border-line bg-white p-2 text-base">
                <span>{g.map((e) => `${e.name}（${e.used}）${e.row ? "" : "［無］"}`).join("・")}</span>
                {g.map((e) => (
                  <button key={e.key} type="button" disabled={busy} onClick={() => merge(kind, g, e.name, `「${e.name}」にまとめた`)} className={SUB}>
                    「{e.name}」にまとめる
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          さがす
          <input value={q} onChange={(e) => setQ(e.target.value)} className={`${INPUT} w-64`} />
        </label>
        {none.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              confirm(`一覧に無い名前 ${none.length}件を、そのまま一覧に足します。よろしいですか？`) &&
              post({ kind: "save", put: none.map((e) => ({ id: newId(), isNew: true, base: "", f: { kind, name: e.name, aliases: "", sort_order: "", unused: "", memo: "" } })), del: [], note: "一覧に無い名前を足した" }, doneText)
            }
            className={SUB}
          >
            一覧に無い名前を全部足す（{none.length}）
          </button>
        )}
        {kind === "不良の理由" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const have = new Set(entries.filter((e) => e.row).map((e) => e.name));
              const add = COMMON_REASONS.filter((r) => !have.has(r));
              if (!add.length) return alert("よくある理由はもう入っています");
              post({ kind: "save", put: add.map((name, i) => ({ id: newId() + i, isNew: true, base: "", f: { kind, name, aliases: "", sort_order: String(i + 1), unused: "", memo: "" } })), del: [], note: "よくある不良の理由を入れた" }, doneText);
            }}
            className={SUB}
          >
            よくある理由を入れる
          </button>
        )}
      </div>

      {picked.length >= 2 && (
        <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-4 rounded-lg border-2 border-accent bg-white p-4 text-base">
          <span>{picked.length}件を選んでいます。残す名前：</span>
          <select value={keep} onChange={(e) => setKeep(e.target.value)} className={INPUT}>
            <option value="">（選ぶ）</option>
            {[...new Set([...picked.map((e) => e.name), ...entries.filter((e) => e.row).map((e) => e.name)])].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !keep} onClick={() => merge(kind, picked, keep, `「${keep}」にまとめた`)} className={MAIN}>
            にまとめる
          </button>
          <button type="button" onClick={() => setSel(new Set())} className={SUB}>
            選ぶのをやめる
          </button>
        </div>
      )}

      <p className="mt-4 text-sm text-ink-sub">
        「無」＝データに出てくるが一覧に無い名前。左のチェックで2つ以上選ぶと、まとめられます。数＝今あるデータに出てくる回数（別の書き方も合わせて）。
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-base">
          <thead className="bg-card">
            <tr>
              {["", "名前", "別の書き方", "並び", "使わない", "メモ", "数", ""].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) =>
              edit === e.key && e.row ? (
                <EditRow key={e.key} kind={kind} row={e.row} busy={busy} post={post} doneText={doneText} onCancel={() => setEdit(null)} />
              ) : (
                <tr key={e.key} className={`border-b border-line ${e.row ? "" : "bg-warn-bg"}`}>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={sel.has(e.key)}
                      onChange={(ev) => {
                        const n = new Set(sel);
                        if (ev.target.checked) n.add(e.key);
                        else n.delete(e.key);
                        setSel(n);
                      }}
                      className="h-5 w-5"
                      aria-label={`${e.name}を選ぶ`}
                    />
                  </td>
                  <td className="px-2 py-1 font-bold">
                    {e.name}
                    {!e.row && <span className="ml-2 rounded border border-ink-sub px-1 text-sm font-normal">無</span>}
                  </td>
                  <td className="px-2 py-1">{e.row?.aliases.split("｜").join("・")}</td>
                  <td className="px-2 py-1 text-right">{e.row?.sort_order}</td>
                  <td className="px-2 py-1">{e.row?.unused === "1" ? "使わない" : ""}</td>
                  <td className="px-2 py-1">{e.row?.memo}</td>
                  <td className="px-2 py-1 text-right">{e.used}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {e.row ? (
                      <>
                        <button type="button" onClick={() => setEdit(e.key)} className={SUB}>
                          直す
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            confirm(`「${e.name}」を一覧から外します。名寄せも外れ、次の取り込みでエムネットの書き方に戻ることがあります。よろしいですか？`) &&
                            post({ kind: "save", put: [], del: [{ id: e.row!.id, base: e.row!.mark }], note: `「${e.name}」を外した` }, doneText)
                          }
                          className={`${DANGER} ml-2`}
                        >
                          外す
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => post({ kind: "save", put: [{ id: newId(), isNew: true, base: "", f: { kind, name: e.name, aliases: "", sort_order: "", unused: "", memo: "" } }], del: [], note: `「${e.name}」を足した` }, doneText)}
                        className={SUB}
                      >
                        一覧に足す
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-lg border border-line p-4">
        <label className="flex flex-col gap-2 text-sm">
          新しい名前
          <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} className={`${INPUT} w-56`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          別の書き方（「｜」か改行で区切る）
          <input value={nf.aliases} onChange={(e) => setNf({ ...nf, aliases: e.target.value })} className={`${INPUT} w-72`} />
        </label>
        <button
          type="button"
          disabled={busy || !nf.name.trim()}
          onClick={async () => {
            if (await post({ kind: "save", put: [{ id: newId(), isNew: true, base: "", f: { kind, name: nf.name, aliases: nf.aliases, sort_order: "", unused: "", memo: "" } }], del: [], note: `「${nf.name}」を足した` }, doneText))
              setNf({ name: "", aliases: "" });
          }}
          className={MAIN}
        >
          足す
        </button>
      </div>
    </div>
  );
}

function EditRow({
  kind,
  row,
  busy,
  post,
  doneText,
  onCancel,
}: {
  kind: Kind;
  row: Row;
  busy: boolean;
  post: (body: unknown, done: (j: Record<string, number>) => string) => Promise<boolean>;
  doneText: (j: Record<string, number>) => string;
  onCancel: () => void;
}) {
  const [f, setF] = useState({ name: row.name, aliases: row.aliases, sort_order: row.sort_order, unused: row.unused, memo: row.memo });
  return (
    <tr className="border-b border-line">
      <td />
      <td className="px-2 py-1">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`${INPUT} w-40`} aria-label="名前" />
      </td>
      <td className="px-2 py-1">
        <input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} className={`${INPUT} w-56`} aria-label="別の書き方" />
      </td>
      <td className="px-2 py-1">
        <input value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} inputMode="decimal" className={`${INPUT} w-20 text-right`} aria-label="並び" />
      </td>
      <td className="px-2 py-1">
        <input type="checkbox" checked={f.unused === "1"} onChange={(e) => setF({ ...f, unused: e.target.checked ? "1" : "" })} className="h-5 w-5" aria-label="使わない" />
      </td>
      <td className="px-2 py-1">
        <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} className={`${INPUT} w-40`} aria-label="メモ" />
      </td>
      <td />
      <td className="whitespace-nowrap px-2 py-1">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            post(
              { kind: "save", put: [{ id: row.id, isNew: false, base: row.mark, f: { kind, ...f } }], del: [], note: f.name !== row.name ? `「${row.name}」を「${f.name}」に直した` : `「${f.name}」を直した` },
              doneText
            )
          }
          className={MAIN}
        >
          保存
        </button>
        <button type="button" onClick={onCancel} className={`${SUB} ml-2`}>
          やめる
        </button>
      </td>
    </tr>
  );
}

function Holidays({
  list,
  busy,
  post,
}: {
  list: { date: string; memo: string }[];
  busy: boolean;
  post: (body: unknown, done: (j: Record<string, number>) => string) => Promise<boolean>;
}) {
  const [d, setD] = useState("");
  const [memo, setMemo] = useState("");
  const norm = (s: string) => {
    const m = s.normalize("NFKC").trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    return m ? `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}` : s.trim();
  };
  return (
    <section className="mt-4">
      <p className="text-base">土日のほかの休みを入れます（土日は入れなくても休み）。ガントで日付を灰色にするのに使います。</p>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">
          日付
          <input value={d} onChange={(e) => setD(e.target.value)} placeholder="2026/12/29" className={`${INPUT} w-40`} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          メモ
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例：年末年始" className={`${INPUT} w-56`} />
        </label>
        <button
          type="button"
          disabled={busy || !d.trim()}
          onClick={async () => {
            if (await post({ kind: "hol", put: [{ date: norm(d), memo }], del: [] }, () => "足しました")) {
              setD("");
              setMemo("");
            }
          }}
          className={MAIN}
        >
          足す
        </button>
      </div>
      <table className="mt-4 text-base">
        <thead className="bg-card">
          <tr>
            {["日付", "曜日", "メモ", ""].map((h) => (
              <th key={h} className="border-b border-line px-2 py-1 text-left font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-ink-sub">
                まだありません。
              </td>
            </tr>
          )}
          {list.map((h) => {
            const [y, m, dd] = h.date.split("/").map(Number);
            const w = "日月火水木金土"[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
            return (
              <tr key={h.date} className="border-b border-line">
                <td className="px-2 py-1">{h.date}</td>
                <td className="px-2 py-1">{w}</td>
                <td className="px-2 py-1">{h.memo}</td>
                <td className="px-2 py-1">
                  <button type="button" disabled={busy} onClick={() => post({ kind: "hol", put: [], del: [h.date] }, () => "外しました")} className={DANGER}>
                    外す
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
