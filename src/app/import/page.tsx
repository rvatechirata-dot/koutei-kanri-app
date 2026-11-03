import { getCurrentUser, isAdmin } from "@/lib/auth";
import ImportPanel from "@/components/import/ImportPanel";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return <p className="py-8 text-base">CSVを取り込めるのは管理者だけです。</p>;
  }
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT at, account, file, added, changed, deleted FROM import_history ORDER BY id DESC LIMIT 30")
    .all<{ at: string; account: string; file: string; added: number; changed: number; deleted: number }>();
  return (
    <div>
      <ImportPanel />
      <section className="mt-8 max-w-5xl">
        <h2 className="text-xl font-bold">取り込みの履歴（新しい30件）</h2>
        {results.length === 0 ? (
          <p className="mt-2 text-base text-ink-sub">まだありません。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-base">
              <thead className="bg-card">
                <tr>
                  {["日時", "人", "ファイル", "新しい", "変わった", "消した"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, k) => (
                  <tr key={k} className="border-b border-line">
                    <td className="whitespace-nowrap px-2 py-1">{r.at}</td>
                    <td className="px-2 py-1">{r.account}</td>
                    <td className="px-2 py-1">{r.file}</td>
                    <td className="px-2 py-1 text-right">{r.added}</td>
                    <td className="px-2 py-1 text-right">{r.changed}</td>
                    <td className="px-2 py-1 text-right">{r.deleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
