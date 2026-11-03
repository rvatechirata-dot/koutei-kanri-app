import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadBoard } from "@/lib/kotei/board";

export const dynamic = "force-dynamic";

/** 工程一覧のデータ（Access を通れた人は全員見られる） */
export async function GET() {
  await getCurrentUser();
  return Response.json(await loadBoard(await getDb()));
}
