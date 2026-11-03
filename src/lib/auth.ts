import { cookies, headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getMasterDb } from "./db";
import type { CurrentUser } from "./types";

const ACCESS_HEADER = "cf-access-authenticated-user-email";

/**
 * ログイン中のユーザーを返す。
 * 本番: Cloudflare Access が付与するヘッダーのメールアドレスで識別する。
 * 開発: ヘッダーが無い場合のみ、開発用Cookie（dev_user_email）で代用する。
 *
 * Access を通れた社員は全員使える（工程一覧を見る・工程の開始・完了・作業を押す）。アプリ側に担当者の登録は無い。
 * 管理者（CSVの取り込み・操作ログ・ほかの人の作業を直す）は wrangler.jsonc の ADMIN_EMAILS で決める。
 * 作業者の名前は、ログインした人の全社マスタの名前。共有メールなどで名前が決まらない（named=false）ときだけ、画面で選んだ名前を使う。
 * 名前は全社マスタ（master-db の employees）からメールで引く。引けないときはメールのまま。
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const h = await headers();
  let email = h.get(ACCESS_HEADER);

  if (!email && process.env.NODE_ENV === "development") {
    const c = await cookies();
    email = c.get("dev_user_email")?.value ?? "dev@example.com";
  }
  if (!email) {
    // Cloudflare Access を通っていないアクセスは想定外
    throw new Error("認証情報がありません。Cloudflare Access の設定を確認してください。");
  }
  email = email.toLowerCase();

  const name = await nameOf(email);
  return { email, name: name ?? email, named: name !== null, role: (await adminEmails()).includes(email) ? "admin" : "staff" };
}

/** 管理者のメール（wrangler.jsonc の vars.ADMIN_EMAILS・カンマ区切り） */
export async function adminEmails(): Promise<string[]> {
  const { env } = await getCloudflareContext({ async: true });
  const raw = (env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS ?? "";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * 全社マスタの社員名。部署で共有しているメール（1つのメールに複数人）は誰か決まらないので null（呼び出し側でメールのまま出す）。
 * 全社マスタが読めないとき（開発中など）も null。
 */
async function nameOf(email: string): Promise<string | null> {
  try {
    const mdb = await getMasterDb();
    const { results } = await mdb
      .prepare("SELECT name FROM employees WHERE lower(email) = ? AND is_active = 1 AND canonical_id IS NULL LIMIT 2")
      .bind(email)
      .all<{ name: string }>();
    return results.length === 1 ? results[0].name : null;
  } catch {
    return null;
  }
}

export function isAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}
