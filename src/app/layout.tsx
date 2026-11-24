import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
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
        {/* 上のメニュー：今開いている画面のタブを明るく太字にする（出来高アプリと同じ形・2026-11-24） */}
        <Nav admin={isAdmin(user)} userLabel={`${user.name}${isAdmin(user) ? "（管理者）" : ""}`} />
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
