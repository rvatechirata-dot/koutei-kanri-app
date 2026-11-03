"use client";

import { useEffect, useState } from "react";

/**
 * ログインの期限切れを見分けて案内を出す部品（2026-10-09・ご意見 #63 の横展開）
 *
 * 背景：Cloudflare Access のログイン期限が切れると、/api/ への fetch はログイン画面への
 * 転送（302）で返る。ブラウザはこれを別サイトへの転送として扱い fetch を例外にするため、
 * 各画面は「通信できませんでした」と出し、電波が戻っても同じ表示が続いていた。
 *
 * 仕組み：layout.tsx に <LoginGuard /> を1つ置くと、この画面の中の fetch のうち
 * 「/api/ で始まる同じサイト宛て」だけを、転送を追いかけない設定（redirect:"manual"）で送る。
 * 転送が返ってきたら（＝ログイン切れ）、画面の上に案内と「ログインし直す」ボタンを出し、
 * 呼び出し元には今までどおり例外を返す（各画面の「通信できませんでした」の表示はそのまま）。
 * ログインし直しは別のタブで行うので、入力中の内容は消えない。
 *
 * - /api/ 以外（ページの切り替えなど Next.js 自身の通信）には触らない
 * - 使い方：import LoginGuard from "@/components/LoginGuard"; <body> の中に <LoginGuard />
 * - 正本は feedback-app/drop-in/LoginGuard.tsx（各アプリにはコピー）
 */

const TEXT =
  "ログインの期限が切れています（電波の問題ではありません）。「ログインし直す」を押して別のタブでログインし、この画面に戻ってもう一度同じ操作をしてください。入力した内容は消えていません。";

declare global {
  interface Window {
    __loginGuardInstalled?: boolean;
  }
}

function isApiUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/api/")) return true;
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export default function LoginGuard() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (window.__loginGuardInstalled) return;
    window.__loginGuardInstalled = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isApiUrl(input)) return orig(input, init);
      const res = await orig(input, { ...init, redirect: "manual" });
      if (res.type === "opaqueredirect" || res.status === 0) {
        setExpired(true);
        // 呼び出し元には、今までの「電波が無いとき」と同じ形（TypeError）で知らせる
        throw new TypeError("login-expired");
      }
      setExpired(false); // 通ったら案内を消す
      return res;
    };
    return () => {
      window.fetch = orig;
      window.__loginGuardInstalled = false;
    };
  }, []);

  if (!expired) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[9999] border-b-4 border-red-600 bg-red-50 px-4 py-3 text-base text-red-800 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
        <p className="font-bold">{TEXT}</p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => window.open(location.pathname + location.search, "_blank", "noopener")}
            className="rounded-lg bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700"
          >
            ログインし直す
          </button>
          <button
            type="button"
            onClick={() => setExpired(false)}
            className="rounded-lg border border-red-400 bg-white px-3 py-2 text-base text-red-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
