export type Role = "staff" | "admin";

export interface CurrentUser {
  email: string;
  name: string;
  /** 全社マスタで名前が1人に決まったか（共有メールなどは false＝作業者は画面で選ぶ） */
  named: boolean;
  /** admin＝管理者（wrangler.jsonc の ADMIN_EMAILS）。ほかは全員 staff */
  role: Role;
}
