import { getDb } from "./db";
import { nowJst } from "./kotei/time";

/**
 * 操作ログ（誰がいつ何をしたか）を残すための道具。
 *
 * 方針:
 * - 記録するのは「変えた・消した」操作だけ。閲覧（開いただけ）は記録しない
 *   （件数が膨大になり、D1の1日10万行の書き込み枠を食うため）。
 * - ログの記録に失敗しても、本来の処理（INPUTの保存など）は止めない。
 * - 実行者は Cloudflare Access のメール。呼び出し側が持っている user.email を渡す。
 * - 日時は日本時間の文字（このアプリの決まり。migrations/0001_init.sql の冒頭）。
 * - CSVの取り込みは、取り込みと同じまとまりで書くため importer.ts が自分で入れる。
 */

export interface OperationLog {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
}

export type OpAction = "import" | "create" | "edit" | "delete";

export type OpTarget = "csv" | "item" | "case" | "master";

export const OP_ACTION_LABELS: Record<string, string> = {
  import: "取り込み",
  create: "新規作成",
  edit: "編集",
  delete: "削除",
};

export const OP_TARGET_LABELS: Record<string, string> = {
  csv: "エムネットのCSV",
  item: "品目",
  case: "案件",
  master: "基本の一覧",
};

/** 操作ログを1件残す。失敗しても呼び出し元の処理は止めない。 */
export async function logOp(params: {
  actor: string;
  action: OpAction;
  targetType: OpTarget;
  targetId: string | null;
  summary: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    await db
      .prepare(
        "INSERT INTO operation_logs (at, actor, action, target_type, target_id, summary) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(nowJst(), params.actor, params.action, params.targetType, params.targetId, params.summary)
      .run();
  } catch {
    // ログ失敗は無視（本処理を止めない）
  }
}

export async function listOps(limit = 300): Promise<OperationLog[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT * FROM operation_logs ORDER BY id DESC LIMIT ${Number(limit)}`)
    .all<OperationLog>();
  return results;
}
