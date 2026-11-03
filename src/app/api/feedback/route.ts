import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * 各アプリに置く「ご意見」の中継口（正本は feedback-app/drop-in/。各アプリへは src/app/api/feedback/route.ts にコピー）
 *
 *   POST … 画面の FeedbackButton から受け取り、ログインメール・アプリ名・会社を付けてご意見箱へ渡す
 *   GET  … このアプリ宛てに届いたご意見の一覧（対応状況・返事つき）を返す（「状況を見る」タブ用）
 *   GET ?shot=ID … その1件の画面の写しを取り次ぐ（サムネイル用）
 *   DELETE … 送った本人が自分の意見を消す（ログインのメールが同じか、送信時に端末へ控えた合鍵が合えば消せる）
 *
 * 送り先は、同じアカウント内の中継Worker（feedback-relay）。伝票（wrangler.jsonc）に
 *   "services": [ { "binding": "FEEDBACK", "service": "feedback-relay" } ]
 * と書くだけ。合鍵や Access のサービストークンは中継が持つので、**このアプリには秘密の値を入れない**。
 * アプリ名は vars の FEEDBACK_APP_NAME、Worker名は FEEDBACK_APP_KEY。
 *
 * 開発中（next dev）だけは、.dev.vars の FEEDBACK_URL（ご意見箱の開発サーバー）＋ FEEDBACK_SECRET に直接送る。
 */

type FeedbackEnv = {
  FEEDBACK?: Fetcher;
  FEEDBACK_APP_NAME?: string;
  FEEDBACK_APP_KEY?: string;
  COMPANY?: string;
  FEEDBACK_COMPANY?: string; // COMPANY の設定が無いアプリ用（rvatec / kwatec）
  // 開発用
  FEEDBACK_URL?: string;
  FEEDBACK_SECRET?: string;
};

const ACCESS_HEADER = "cf-access-authenticated-user-email";

async function getFeedbackEnv(): Promise<FeedbackEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as FeedbackEnv;
}

function devDirect(e: FeedbackEnv): boolean {
  return process.env.NODE_ENV === "development" && !!e.FEEDBACK_URL;
}

function notConfigured(e: FeedbackEnv): boolean {
  return !e.FEEDBACK && !devDirect(e);
}

/** 中継Worker（開発中はご意見箱の開発サーバー）を呼ぶ。つながらなければ例外 */
async function callRelay(e: FeedbackEnv, path: string, init: RequestInit): Promise<Response> {
  if (devDirect(e)) {
    const h = new Headers(init.headers);
    h.set("x-feedback-secret", e.FEEDBACK_SECRET ?? "");
    return fetch(`${e.FEEDBACK_URL!.replace(/\/$/, "")}${path}`, { ...init, headers: h });
  }
  return e.FEEDBACK!.fetch(`https://feedback-relay${path}`, init);
}

async function relayError(res: Response): Promise<Response> {
  const t = await res.text().catch(() => "");
  // Access のログイン画面（HTML）が返ってきた＝中継のサービストークンが未設定か無効
  const hint = t.startsWith("<") ? "中継の認証（サービストークン）を確認してください。" : t.slice(0, 200);
  return Response.json({ error: `送り先で受け付けられませんでした（${res.status}）。${hint}` }, { status: 502 });
}

export async function POST(req: Request) {
  const e = await getFeedbackEnv();
  if (notConfigured(e)) {
    return Response.json({ error: "ご意見の送り先がまだ設定されていません。管理者に連絡してください。" }, { status: 503 });
  }

  let b: {
    app?: string;
    pageUrl?: string;
    pageTitle?: string;
    kind?: string;
    body?: string;
    userName?: string | null;
    image?: string | null;
    screen?: string;
  };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "内容が読めません。" }, { status: 400 });
  }
  if (!b.body?.trim()) return Response.json({ error: "内容を書いてください。" }, { status: 400 });

  const h = await headers();
  const payload = {
    app: e.FEEDBACK_APP_NAME ?? b.app ?? "",
    appKey: e.FEEDBACK_APP_KEY ?? "",
    company: e.COMPANY ?? e.FEEDBACK_COMPANY ?? "",
    pageUrl: b.pageUrl ?? "",
    pageTitle: b.pageTitle ?? "",
    userEmail: h.get(ACCESS_HEADER),
    userName: b.userName ?? null,
    kind: b.kind ?? "idea",
    body: b.body,
    image: b.image ?? null,
    userAgent: h.get("user-agent") ?? "",
    screen: b.screen ?? "",
  };

  let res: Response;
  try {
    res = await callRelay(e, "/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return Response.json({ error: "送り先につながりませんでした。時間をおいて試してください。" }, { status: 502 });
  }
  if (!res.ok) return relayError(res);
  const d = (await res.json().catch(() => null)) as { ok?: boolean; id?: number; token?: string } | null;
  if (!d || !d.ok) {
    // 200 でも中身が JSON の ok でなければ届いていない（例：ログイン画面が返った）
    return Response.json({ error: "送り先から正しい応答がありませんでした。管理者に連絡してください。" }, { status: 502 });
  }
  // token＝送った本人がこの端末から消すための合鍵（画面側が端末に控える）
  return Response.json({ ok: true, id: d.id ?? null, token: d.token ?? null });
}

/**
 * GET ?shot=ID … その1件の画面の写し（画像）を取り次いで返す（サムネイル表示用）
 * GET        … このアプリ宛てのご意見の一覧。ログインしている人の分には mine=true を付ける
 */
export async function GET(req: Request) {
  const e = await getFeedbackEnv();
  if (notConfigured(e)) {
    return Response.json({ error: "ご意見の送り先がまだ設定されていません。" }, { status: 503 });
  }

  const shot = new URL(req.url).searchParams.get("shot");
  if (shot) {
    const n = Number(shot);
    if (!Number.isInteger(n) || n <= 0) return new Response("Not Found", { status: 404 });
    let img: Response;
    try {
      img = await callRelay(e, `/api/shot/${n}`, { method: "GET" });
    } catch {
      return new Response("Bad Gateway", { status: 502 });
    }
    if (!img.ok || !(img.headers.get("Content-Type") ?? "").startsWith("image/")) {
      return new Response("Not Found", { status: 404 });
    }
    const headers = new Headers();
    headers.set("Content-Type", img.headers.get("Content-Type") ?? "image/jpeg");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(img.body, { headers });
  }

  const appKey = e.FEEDBACK_APP_KEY ?? "";
  if (!appKey) return Response.json({ error: "このアプリの FEEDBACK_APP_KEY が設定されていません。" }, { status: 503 });

  let res: Response;
  try {
    res = await callRelay(e, `/api/list?appKey=${encodeURIComponent(appKey)}&limit=100`, { method: "GET" });
  } catch {
    return Response.json({ error: "送り先につながりませんでした。時間をおいて試してください。" }, { status: 502 });
  }
  if (!res.ok) return relayError(res);

  const h = await headers();
  const me = (h.get(ACCESS_HEADER) ?? "").toLowerCase();
  const d = (await res.json().catch(() => null)) as {
    items?: Array<Record<string, unknown> & { user_email?: string | null }>;
  } | null;
  if (!d || !Array.isArray(d.items)) {
    return Response.json({ error: "送り先から正しい応答がありませんでした。管理者に連絡してください。" }, { status: 502 });
  }
  const items = d.items.map((it) => {
    const { user_email, ...rest } = it;
    // 他人のメールアドレスは画面に出さない。自分の分かどうかだけ返す
    return { ...rest, mine: !!me && (user_email ?? "").toLowerCase() === me };
  });
  return Response.json({ items, loggedIn: !!me });
}

/** 送った本人による削除。{ id, token } を受け取り、ログインメールと合鍵を添えてご意見箱へ渡す */
export async function DELETE(req: Request) {
  const e = await getFeedbackEnv();
  if (notConfigured(e)) {
    return Response.json({ error: "意見の送り先がまだ設定されていません。" }, { status: 503 });
  }
  let b: { id?: number; token?: string | null };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: "内容が読めません。" }, { status: 400 });
  }
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "IDが正しくありません。" }, { status: 400 });

  const h = await headers();
  let res: Response;
  try {
    res = await callRelay(e, "/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, token: b.token ?? null, userEmail: h.get(ACCESS_HEADER) }),
    });
  } catch {
    return Response.json({ error: "送り先につながりませんでした。時間をおいて試してください。" }, { status: 502 });
  }
  const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !d?.ok) {
    return Response.json({ error: d?.error ?? `削除できませんでした（${res.status}）。` }, { status: res.ok ? 502 : res.status });
  }
  return Response.json({ ok: true });
}
