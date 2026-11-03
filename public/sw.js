// PWA（ホーム画面アプリ化）用の最小サービスワーカー。
// 方針：オンライン時は必ずネットワークから最新を表示する（古い版が残る事故を防ぐ）。
//       ページ遷移だけ、オフライン時に「最後に見たページ」を出すためのフォールバックを持つ。
//       API通信や画像はキャッシュしない（＝データは常に最新）。
// ⚠️ 画面の修正を全端末（特にホーム画面版）へ確実に配るときは、このバージョン番号を上げる。
// 上げると新SWが有効化され、PwaRegister が自動でページを1回リロードして最新版になる。
const CACHE = "koutei-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 古いキャッシュを掃除
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 送信系（POST等）は素通し
  // ページ遷移（HTML）＝ネットワーク優先。取れたらキャッシュも更新し、
  // 通信できないときだけ直近のキャッシュを返す。
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || (await caches.match("/")) || Response.error();
        }
      })()
    );
  }
  // それ以外（API・画像・CSS/JS）は素通し＝常に最新を取りに行く
});
