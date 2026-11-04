"use client";

/**
 * エムネットの案件一覧CSVの取り込み画面。
 * ①CSVを選ぶ → ②ブラウザで読む（Shift_JIS） → ③サーバーで今のデータと比べる（まだ保存しない）
 * → ④「新しい・変わる・変わらない・CSVにない」を見て、入れる／入れないを選ぶ → ⑤取り込む（まとめて1回で保存）
 * 手順は川﨑部長の手順書「工程管理_エムネットCSV毎日取り込み手順」と同じ（カテゴリー2＝製造技術で絞って書き出す）。
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { decodeCsv, readMnetCsv } from "@/lib/kotei/csv";
import type { CsvRec } from "@/lib/kotei/types";
import type { Preview, CommitResult } from "@/lib/kotei/importer";

interface Loaded {
  file: string;
  recs: CsvRec[];
  errs: string[];
}

export default function ImportPanel() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [msg, setMsg] = useState("");
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CommitResult | null>(null);
  // 選んだもの（バーコード番号）
  const [skipAdd, setSkipAdd] = useState<Set<string>>(new Set());
  const [skipChg, setSkipChg] = useState<Set<string>>(new Set());
  const [takeOld, setTakeOld] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function compare(l: Loaded, note = "") {
    setBusy(true);
    setFatal("");
    try {
      const r = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recs: l.recs }) });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error || "比べられませんでした");
      setPv(j as Preview);
      setSkipAdd(new Set());
      setSkipChg(new Set());
      setTakeOld(new Set());
      setGone(new Set());
      setMsg(note);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setDone(null);
    setPv(null);
    setMsg("");
    const text = decodeCsv(await file.arrayBuffer());
    const read = readMnetCsv(text);
    if (read.fatal) {
      setLoaded(null);
      setFatal(read.fatal);
      return;
    }
    const l = { file: file.name, recs: read.recs, errs: read.errs };
    setLoaded(l);
    await compare(l);
  }

  async function commit() {
    if (!loaded || !pv) return;
    const nAdd = pv.add.filter((e) => (e.old ? takeOld.has(e.bc) : !skipAdd.has(e.bc))).length;
    const nChg = pv.chg.filter((e) => !skipChg.has(e.bc)).length;
    const nDel = gone.size;
    if (!nAdd && !nChg && !nDel) {
      setMsg("取り込むものがありません。");
      return;
    }
    if (!confirm(`取り込みます。\n新しい ${nAdd}件 ・ 変わる ${nChg}件 ・ 消す ${nDel}件\nよろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recs: loaded.recs,
          ver: pv.ver,
          file: loaded.file,
          choices: { skipAdd: [...skipAdd], skipChg: [...skipChg], takeOld: [...takeOld], gone: [...gone] },
        }),
      });
      const j = await r.json();
      if (r.status === 409) {
        await compare(loaded, (j as { error: string }).error + "（比べ直しました。もう一度確かめて「取り込む」を押してください）");
        return;
      }
      if (!r.ok) throw new Error((j as { error?: string }).error || `保存できませんでした（${r.status}）`);
      setDone(j as CommitResult);
      router.refresh(); // 下の「取り込みの履歴」を新しくする
      setPv(null);
      setLoaded(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setFatal((e instanceof Error ? e.message : String(e)) + "（何も保存されていません。もう一度やり直してください）");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, bc: string) => {
    const n = new Set(set);
    if (n.has(bc)) n.delete(bc);
    else n.add(bc);
    setter(n);
  };

  const oldCount = pv?.add.filter((e) => e.old).length ?? 0;
  const normList = pv ? Object.entries(pv.norm) : [];

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">エムネットのCSVを取り込む</h1>
      <ol className="mt-4 list-decimal pl-8 text-base leading-normal">
        <li>エムネットくらうどの案件一覧で、<b>カテゴリー2を「製造技術」で絞り込む</b>。</li>
        <li>その一覧をCSVで書き出す（<b>エクセルでは開かない</b>。13桁のバーコード番号が壊れます）。</li>
        <li>下でCSVを選ぶ。比べた結果が出ます（まだ保存されません）。</li>
        <li>中身を確かめて「取り込む」を押す。</li>
      </ol>

      <div className="mt-4">
        <label className="flex flex-col gap-2 text-sm">
          案件一覧のCSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0])}
            className="min-h-11 text-base file:mr-4 file:min-h-11 file:rounded-lg file:border file:border-accent file:bg-white file:px-4 file:font-bold file:text-accent"
          />
        </label>
      </div>

      {busy && <p className="mt-4 text-base">処理しています。画面を閉じないでください…</p>}
      {fatal && <p className="mt-4 rounded border border-danger bg-white p-4 text-base text-danger">{fatal}</p>}
      {done && (
        <div className="mt-4 rounded-lg border border-ok bg-white p-4 text-base">
          <p className="font-bold text-ok">取り込みました。</p>
          <p className="mt-2">
            新しい {done.added}件 ・ 変わった {done.changed}件 ・ 消した {done.deleted}件
            {done.stockMoves ? ` ・ 在庫の動き ${done.stockMoves}件` : ""}
          </p>
          <Link href="/board" className="mt-2 inline-block text-accent underline">
            工程一覧を見る
          </Link>
        </div>
      )}

      {loaded && loaded.errs.length > 0 && (
        <div className="mt-4 rounded border border-danger bg-white p-4 text-base">
          <p className="font-bold text-danger">飛ばした行・気をつける行（{loaded.errs.length}件）</p>
          <ul className="mt-2 list-disc pl-8">
            {loaded.errs.slice(0, 50).map((e, k) => (
              <li key={k}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {pv && loaded && (
        <section className="mt-8">
          <p className="text-base">
            <b>{loaded.file}</b> を読みました（{loaded.recs.length}行）。<b>まだ保存していません。</b>下を確かめて「取り込む」を押してください。
          </p>
          {msg && <p className="mt-2 rounded bg-warn-bg p-2 text-base">{msg}</p>}
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Count label="新しい" n={pv.add.length} />
            <Count label="変わる" n={pv.chg.length} />
            <Count label="変わらない" n={pv.same} />
            <Count label="CSVにない" n={pv.gone.length} />
          </div>
          {pv.mine > 0 && <p className="mt-2 text-sm text-ink-sub">この画面で登録した品目 {pv.mine}件は、エムネットに無いので比べていません。</p>}
          {normList.length > 0 && (
            <details className="mt-2 text-base">
              <summary className="cursor-pointer">名寄せで、CSVの書き方を {normList.reduce((s, [, n]) => s + n, 0)}か所そろえてから比べました</summary>
              <ul className="mt-2 list-disc pl-8 text-sm">
                {normList.slice(0, 100).map(([k, n]) => (
                  <li key={k}>
                    {k}（{n}）
                  </li>
                ))}
              </ul>
            </details>
          )}
          {oldCount > 0 && (
            <p className="mt-4 rounded bg-warn-bg p-2 text-base">
              新しい品目のうち <b>{oldCount}件</b> は、納期が2025年より前で、終わった工程がありません（古い案件）。最初は取り込まない設定にしています。入れるものは下でチェックしてください。
            </p>
          )}

          <Section title={`新しい（${pv.add.length}件）`} hint="チェックを外したものは入れません。">
            {pv.add.map((e) => {
              const on = e.old ? takeOld.has(e.bc) : !skipAdd.has(e.bc);
              return (
                <Row key={e.bc} on={on} onChange={() => (e.old ? toggle(takeOld, setTakeOld, e.bc) : toggle(skipAdd, setSkipAdd, e.bc))}>
                  <b>{e.mgmt_no}</b> {e.drawing_no} {e.name}　{e.customer}　納期 {e.final_due || "－"}　工程 {e.procs}
                  {e.old && <span className="ml-2 rounded border border-line px-1 text-sm">古い案件</span>}
                </Row>
              );
            })}
          </Section>

          <Section title={`変わる（${pv.chg.length}件）`} hint="何が変わったかが出ます。エムネットで入れた内容と合っているか見てください。">
            {pv.chg.map((e) => (
              <Row key={e.bc} on={!skipChg.has(e.bc)} onChange={() => toggle(skipChg, setSkipChg, e.bc)}>
                <b>{e.mgmt_no}</b> {e.drawing_no} {e.name}
                {e.stock > 0 && <span className="ml-2 text-sm">（在庫の動き {e.stock}件）</span>}
                <ul className="mt-1 list-disc pl-8 text-sm">
                  {e.ch.map((c, k) => (
                    <li key={k}>{c}</li>
                  ))}
                </ul>
              </Row>
            ))}
          </Section>

          <Section title={`CSVにない（${pv.gone.length}件）`} hint="エムネットで納品済みになった品目や、消した品目です。消すときだけチェックしてください（消したものはごみ箱に残ります）。">
            {pv.gone.map((e) => (
              <Row key={e.bc} on={gone.has(e.bc)} onChange={() => toggle(gone, setGone, e.bc)} danger>
                <b>{e.mgmt_no}</b> {e.drawing_no} {e.name}　納期 {e.final_due || "－"}　工程 {e.done}/{e.procs} 済
              </Row>
            ))}
          </Section>

          <div className="sticky bottom-0 mt-8 border-t border-line bg-white py-4">
            <button type="button" onClick={commit} disabled={busy} className="min-h-11 rounded-lg bg-accent px-8 text-base font-bold text-white disabled:opacity-50">
              取り込む
            </button>
          </div>
        </section>
      )}
    </div>
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

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  return (
    <details className="mt-8" open={list.length > 0 && list.length <= 50}>
      <summary className="cursor-pointer text-xl font-bold">{title}</summary>
      <p className="mt-2 text-sm text-ink-sub">{hint}</p>
      <div className="mt-2 flex flex-col gap-2">{list.length ? children : <p className="text-base text-ink-sub">ありません。</p>}</div>
    </details>
  );
}

function Row({ on, onChange, children, danger }: { on: boolean; onChange: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <label className={`flex gap-2 rounded border p-2 text-base ${on && danger ? "border-danger" : "border-line"}`}>
      <input type="checkbox" checked={on} onChange={onChange} className="mt-1 h-5 w-5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </label>
  );
}
