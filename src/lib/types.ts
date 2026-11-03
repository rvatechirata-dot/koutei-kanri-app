export type Role = "staff" | "admin";

export interface CurrentUser {
  email: string;
  name: string;
  /** admin＝管理者（wrangler.jsonc の ADMIN_EMAILS）。ほかは全員 staff */
  role: Role;
}
