import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB;
}

/** 全社マスタ(master-db)。ログインした人の名前を引くためだけに読む（書かない） */
export async function getMasterDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  return (env as unknown as { MASTER_DB: D1Database }).MASTER_DB;
}
