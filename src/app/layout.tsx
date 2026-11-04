import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import DevUserSwitcher from "@/components/DevUserSwitcher";
import PwaRegister from "@/components/PwaRegister";
import FeedbackButton from "@/components/FeedbackButton";
import LoginGuard from "@/components/LoginGuard";
import AppVersion from "@/components/AppVersion";

export const metadata: Metadata = {
  title: "工程管理",
  description: "受注（エムネットの案件）がどの工程にいるかを一目で見る",
  // PWA（ホーム画面アプリ化）
  // ※ manifest はここに書かない。Cloudflare Access に弾かれてPWAとして認識されないため、
  //    下の <head> で crossOrigin="use-credentials" 付きで読み込んでいる。
  applicationName: "工程管理",
  appleWebApp: {
    capable: true,
    title: "工程管理",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light", // 常にライト表示に固定
  themeColor: "#1F5FBF",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  const isDev = process.env.NODE_ENV === "development";

  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        {/* ログイン情報（Accessのcookie）を付けて取りに行かせる。これが無いとログイン画面が返り、
            ブラウザがPWAと認識できず「ただのショートカット」になる。 */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="min-h-full">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2">
            <Link href="/board" className="border-l-4 border-accent pl-2 text-xl font-bold whitespace-nowrap">
              工程管理
            </Link>
            <nav className="flex flex-wrap items-center gap-4 text-base">
              <Link href="/board" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">工程一覧</Link>
              <Link href="/ship" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">出荷</Link>
              <Link href="/stock" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">在庫</Link>
              {isAdmin(user) && <Link href="/import" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">CSV取り込み</Link>}
              {isAdmin(user) && <Link href="/master" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">基本の一覧</Link>}
              {isAdmin(user) && <Link href="/master" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">基本の一覧</Link>}
              {isAdmin(user) && <Link href="/logs" className="flex min-h-11 items-center text-accent underline-offset-4 hover:underline">操作ログ</Link>}
            </nav>
            <div className="ml-auto text-sm text-ink-sub">
              {user.name}{isAdmin(user) ? "（管理者）" : ""}
            </div>
          </div>
        </header>
        {isDev && <DevUserSwitcher current={user.email} />}
        <main className="mx-auto max-w-[96rem] px-4 py-4 lg:px-8">{children}</main>
        {/* 版番号（GitHub のコミット番号と見比べる用・2026-09-25） */}
        <AppVersion />
        <PwaRegister />
        {/* ログインの期限切れの案内（ご意見 #63・2026-10-09） */}
        <LoginGuard />
        {/* 右下の「ご意見」ボタン。集約アプリ feedback-app に届く（2026-09-24） */}
        <FeedbackButton appName="工程管理" />
      </body>
    </html>
  );
}
