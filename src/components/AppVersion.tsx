"use client";

/**
 * 画面のいちばん下に出す版番号（2026-09-25・全アプリ共通）
 *
 * 番号は next.config.ts がビルドのときに埋め込む（GitHub のコミット番号の先頭7文字＋ビルドした日時）。
 * GitHub のコミット一覧の番号と見比べれば、本番に出ているのがどの版か分かる。
 * コミットしていない変更を含んだまま出したときは「＋変更あり」が付く。
 *
 * 使い方（layout.tsx の </main> のすぐ下に1行）:
 *   <AppVersion />
 *   大画面表示用のページでは出さない: <AppVersion hideOnPaths={["/display"]} />
 */

import { usePathname } from "next/navigation";

export default function AppVersion({ hideOnPaths = [] }: { hideOnPaths?: string[] }) {
  const pathname = usePathname() ?? "";
  if (hideOnPaths.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"))) return null;
  const version = process.env.APP_VERSION || "不明";
  const builtAt = process.env.APP_BUILT_AT;
  return (
    <p style={{ margin: 0, padding: "8px 16px 16px", fontSize: "0.875rem", lineHeight: 1.25, color: "#666666" }}>
      版 {version}
      {builtAt ? `（${builtAt}）` : ""}
    </p>
  );
}
