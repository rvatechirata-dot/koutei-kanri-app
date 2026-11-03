import { cookies } from "next/headers";
import { adminEmails } from "@/lib/auth";

// 開発時専用：ユーザー切り替えAPI（本番では404を返す）
function devOnly(): Response | null {
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not Found", { status: 404 });
  }
  return null;
}

export async function GET() {
  const guard = devOnly();
  if (guard) return guard;
  // 担当者の登録は無いので、管理者と一般の人（例）を出す
  const admins = (await adminEmails()).map((email) => ({ email, name: email, role: "admin" }));
  return Response.json([...admins, { email: "staff@example.com", name: "一般の人（例）", role: "staff" }]);
}

export async function POST(request: Request) {
  const guard = devOnly();
  if (guard) return guard;
  const { email } = (await request.json()) as { email: string };
  const c = await cookies();
  c.set("dev_user_email", email, { path: "/" });
  return Response.json({ ok: true });
}
