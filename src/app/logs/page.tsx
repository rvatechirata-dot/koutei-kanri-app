import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listOps, OP_ACTION_LABELS, OP_TARGET_LABELS } from "@/lib/oplog";
import ScrollWrap from "@/components/ScrollWrap";

export const dynamic = "force-dynamic";

// 目立たせるのは「消した」だけ。取り込み・作る系は青、直す系は黄色。
const ACTION_COLOR: Record<string, string> = {
  import: "bg-blue-100 text-blue-800",
  create: "bg-blue-100 text-blue-800",
  edit: "bg-amber-100 text-amber-800",
  delete: "bg-red-100 text-red-800",
};

export default async function LogsPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h1 className="text-xl font-bold mb-2">操作ログ</h1>
        <p className="text-slate-600">この画面を見られるのは管理者だけです。</p>
        <Link href="/board" className="text-teal-700 hover:underline mt-4 inline-block">
          ← 工程一覧へ
        </Link>
      </div>
    );
  }

  const logs = await listOps(300);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h1 className="text-xl font-bold">操作ログ</h1>
        <Link href="/board" className="text-teal-700 hover:underline">
          ← 工程一覧へ
        </Link>
      </div>
      <p className="text-slate-600 mb-4">
        誰がいつ何をしたかの記録です（新しい順に300件）。CSVの取り込みなど、データを変えた操作が残ります。※画面を開いただけ（閲覧）は記録していません。
      </p>

      {logs.length === 0 ? (
        <p className="text-slate-600 py-10 text-center">まだ操作ログはありません。</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <ScrollWrap>
            <table className="w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left px-3 py-2 whitespace-nowrap">日時</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">実行者</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">対象</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">操作</th>
                  <th className="text-left px-3 py-2">内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{l.at}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.actor ?? "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {OP_TARGET_LABELS[l.target_type] ?? l.target_type}
                      {l.target_id ? <span className="text-slate-500"> #{l.target_id}</span> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold ${
                          ACTION_COLOR[l.action] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {OP_ACTION_LABELS[l.action] ?? l.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{l.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollWrap>
        </div>
      )}
    </div>
  );
}
