"use client";

/**
 * エムネットの「作業ログの書き出し」CSVの取り込み（3段目）。1回読み込むと、
 *   ① 作業を写す（工程の中の作業。案件一覧CSVを先に取り込んでおく）
 *   ② 完品在庫数を写す（在庫の「エムネットの写し」）
 * の両方を確かめて、選んだものを写す。同じ行は二重に入らないので、何度読み込んでもよい。
 */
import { useRef, useState } from "react";
import { decodeCsv, parseCsv } from "@/lib/kotei/csv";
import { NEED_STOCK, NEED_WORK, type LogLine, type WorklogPreview } from "@/lib/kotei/worklog";

const COLS: [keyof LogLine, string][] = [
  ["bc", "バーコード"],
  ["proc", "工程名"],
  ["st", "開始時刻"],
  ["en", "終了時刻"],
  ["worker", "作業者"],
  ["qty", "完成数量"],
  ["mc", "機械名"],
  ["dw", "図面番号"],
  ["name", "品名"],
  ["mgmt", "社内管理番号"],
  ["note", "備考"],
];

interface Loaded {
  file: string;
  lines: LogLine[];
  hasWork: boolean;
  hasStock: boolean;
}

export default function WorklogPanel() {
  const [ld, setLd] = useState<Loaded | null>(null);
  const [pv, setPv] = useState<WorklogPreview | null>(null);
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [doWork, setDoWork] = useState(true);
  const [doStock, setDoStock] = useState(true);
  const [init, setInit] = useState(true);
  const ref = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setPv(null);
    setDone("");
    setFatal("");
    const rows = parseCsv(decodeCsv(await file.arrayBuffer()));
    const head = rows[0] ?? [];
    const has = (names: string[]) => names.every((n) => head.includes(n));
    const hasWork = has(NEED_WORK);
    const hasStock = has(NEED_STOCK);
    if (!hasWork && !hasStock) {
      setFatal(`エムネットの「作業ログ」の書き出しCSVではないようです（見出しに ${NEED_WORK.filter((n) => !head.includes(n)).join("・")} がありません）。`);
      return;
    }
    const idx = COLS.map(([, h]) => head.indexOf(h));
    const lines = rows.slice(1).map((r, k) => {
      const o = { line: k + 2 } as LogLine;
      COLS.forEach(([key], i) => ((o as unknown as Record<string, string>)[key] = idx[i] >= 0 ? (r[idx[i]] ?? "") : ""));
      return o;
    });
    const l = { file: file.name, lines, hasWork, hasStock };
    setLd(l);
    setBusy(true);
    try {
      const r = await fetch("/api/worklog/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(l) });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error || "比べられませんでした");
      setPv(j as WorklogPreview);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!ld || !pv) return;
    const w = doWork && pv.hasWork ? pv.work.fresh : 0;
    const s = doStock && pv.hasStock ? pv.stock.fresh : 0;
    if (!w && !s && !(doStock && init && pv.stock.dws.some((b) => b.init))) {
      setDone("写すものがありません。");
      return;
    }
    if (!confirm(`写します。\n作業 ${w}件・完品在庫数の行 ${s}件\nよろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/worklog/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ld, doWork, doStock, init }),
      });
      const j = (await r.json()) as { error?: string; works: number; stock: number; init: number };
      if (!r.ok) throw new Error(j.error || `保存できませんでした（${r.status}）`);
      setDone(`写しました：作業 ${j.works}件・完品在庫数の行 ${j.stock}件・最初の数 ${j.init}件`);
      setPv(null);
      setLd(null);
      if (ref.current) ref.current.value = "";
    } catch (e) {
      setFatal((e instanceof Error ? e.message : String(e)) + "（何も保存されていません）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 max-w-5xl border-t border-line pt-8">
      <h2 className="text-2xl font-bold">エムネットの作業ログCSVを取り込む</h2>
      <ol className="mt-4 list-decimal pl-8 text-base leading-normal">
        <li>
          エムネットのメニューの「作業ログの書き出し」でCSVを書き出す（<b>エクセルでは開かない</b>）。
        </li>
        <li>
          <b>案件一覧CSVを先に取り込んでから</b>、下でCSVを選ぶ。比べた結果が出ます（まだ保存されません）。
        </li>
        <li>写すものを選んで「写す」を押す。同じ行は二重に入らないので、何度読み込んでもかまいません。</li>
      </ol>
      <label className="mt-4 flex flex-col gap-2 text-sm">
        作業ログのCSV
        <input
          ref={ref}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
          className="min-h-11 text-base file:mr-4 file:min-h-11 file:rounded-lg file:border file:border-accent file:bg-white file:px-4 file:font-bold file:text-accent"
        />
      </label>
      {busy && <p className="mt-4 text-base">処理しています。画面を閉じないでください…</p>}
      {fatal && <p className="mt-4 rounded border border-danger bg-white p-4 text-base text-danger">{fatal}</p>}
      {done && <p className="mt-4 rounded border border-ok bg-white p-4 text-base">{done}</p>}

      {pv && ld && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-base">
            <b>{ld.file}</b> を読みました（{pv.total}行
            {pv.stock.from && `・${pv.stock.from}〜${pv.stock.to}`}）。<b>まだ保存していません。</b>
          </p>

          <div className="rounded-lg border border-line p-4">
            <label className="flex min-h-11 items-center gap-2 text-xl font-bold">
              <input type="checkbox" checked={doWork && pv.hasWork} disabled={!pv.hasWork} onChange={(e) => setDoWork(e.target.checked)} className="h-5 w-5" />
              ① 作業を写す
            </label>
            {pv.hasWork ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Count label="写す作業" n={pv.work.fresh} />
                  <Count label="もう写してある" n={pv.work.same} />
                  <Count label="品目が無い" n={pv.work.noItem} />
                  <Count label="工程が見つからない" n={pv.work.noProc.reduce((s, [, n]) => s + n, 0)} />
                </div>
                <p className="mt-2 text-sm text-ink-sub">
                  完品在庫数・材料在庫数の行 {pv.work.stockRows}件は作業には写しません（②で写します）。日時が読めない行 {pv.work.blank}件。
                  {pv.work.amb > 0 && `同じ名前の工程が2つ以上ある品目 ${pv.work.amb}件は、先の工程に入れます。`}
                  写した作業には「エムネット」の札が付き、工程の開始・完了・数は変えません。
                </p>
                {pv.work.noProc.length > 0 && (
                  <details className="mt-2 text-base">
                    <summary className="cursor-pointer">工程が見つからない行（社内管理番号と工程名）</summary>
                    <ul className="mt-2 list-disc pl-8 text-sm">
                      {pv.work.noProc.map(([k, n]) => (
                        <li key={k}>
                          {k}（{n}）
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="mt-2 text-base text-ink-sub">見出しが足りないので、作業は写せません。</p>
            )}
          </div>

          <div className="rounded-lg border border-line p-4">
            <label className="flex min-h-11 items-center gap-2 text-xl font-bold">
              <input type="checkbox" checked={doStock && pv.hasStock} disabled={!pv.hasStock} onChange={(e) => setDoStock(e.target.checked)} className="h-5 w-5" />
              ② 完品在庫数を写す
            </label>
            {pv.hasStock ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Count label="完品在庫数の行" n={pv.stock.all} />
                  <Count label="新しく写す行" n={pv.stock.fresh} />
                  <Count label="図面番号" n={pv.stock.dws.length} />
                </div>
                {pv.stock.missing > 0 && (
                  <p className="mt-2 rounded bg-warn-bg p-2 text-base">
                    前に写した行のうち {pv.stock.missing}行が、このCSVの同じ期間にありません（エムネットで消した・直したのかもしれません）。写した行はそのまま残すので、合わないときは在庫の画面の「数を直す」で直してください。
                  </p>
                )}
                {pv.stock.errs.length > 0 && (
                  <ul className="mt-2 list-disc pl-8 text-sm text-danger">
                    {pv.stock.errs.map((e, k) => (
                      <li key={k}>{e}</li>
                    ))}
                  </ul>
                )}
                {pv.stock.dws.length > 0 && (
                  <>
                    <p className="mt-2 text-sm text-ink-sub">「写したあとの数」が、エムネットの「在庫管理」の画面の完品在庫数と合うか見てください。</p>
                    <div className="mt-2 overflow-x-auto">
                      <table className="text-base">
                        <thead className="bg-card">
                          <tr>
                            {["図面番号", "品名", "このCSVの合計", "新しい行", "写したあとの数", "最初の数"].map((h) => (
                              <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pv.stock.dws.map((b) => (
                            <tr key={b.dw} className="border-b border-line">
                              <td className="whitespace-nowrap px-2 py-1">{b.dw}</td>
                              <td className="px-2 py-1">{b.name}</td>
                              <td className="px-2 py-1 text-right">{b.sum}</td>
                              <td className="px-2 py-1 text-right">{b.fresh}</td>
                              <td className="px-2 py-1 text-right font-bold">{b.after}</td>
                              <td className="px-2 py-1">{b.init ? "まだ無い" : "入っている"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <label className="mt-2 flex min-h-11 items-center gap-2 text-base">
                      <input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} className="h-5 w-5" />
                      まだ最初の数が無い図面番号は、「この画面の計算」の最初の数にもエムネットの数を入れる（最初の日はチェックしたまま）
                    </label>
                  </>
                )}
              </>
            ) : (
              <p className="mt-2 text-base text-ink-sub">見出し（社内管理番号・図面番号・品名など）が足りないので、完品在庫数は写せません。</p>
            )}
          </div>

          <div>
            <button type="button" onClick={commit} disabled={busy} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white disabled:opacity-50">
              写す
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-lg bg-card p-4">
      <div className="text-sm text-ink-sub">{label}</div>
      <div className="text-[2rem] font-bold leading-tight">{n}</div>
    </div>
  );
}
