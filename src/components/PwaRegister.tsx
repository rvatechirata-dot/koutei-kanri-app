"use client";

import { useEffect } from "react";

// ホーム画面アプリ化（PWA）用にサービスワーカーを登録する部品。
// 新しい版がデプロイされたら、スマホ側も自動で最新に切り替わるようにする
// （新しいSWが有効になった瞬間にページを1回だけ読み直す）。
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // 開いている間も新版が出ていないか確認する
        reg.update().catch(() => {});
      })
      .catch(() => {
        /* 登録に失敗しても通常のWebとして動くので無視 */
      });

    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);
  return null;
}
