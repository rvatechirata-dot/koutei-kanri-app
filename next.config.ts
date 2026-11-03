import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { execSync } from "node:child_process";

// next dev 実行時にも Cloudflare のバインディング（D1等）を使えるようにする
initOpenNextCloudflareForDev();

// ── 版番号（2026-09-25・全アプリ共通）──
// ビルドしたときのコミット番号（GitHub と同じ先頭7文字）と日時を埋め込み、画面の下に出す（src/components/AppVersion.tsx）。
// ビルド中に設定が何度読まれても同じ値になるよう、最初に作った値を process.env に控えて使い回す。
if (!process.env.APP_VERSION) {
  const git = (args: string) =>
    execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let version = "不明";
  try {
    version = git("rev-parse --short=7 HEAD") + (git("status --porcelain") ? "＋変更あり" : "");
  } catch {
    // git が使えない場所でビルドしたときは「不明」のまま
  }
  process.env.APP_VERSION = version;
  process.env.APP_BUILT_AT = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}
const appVersionEnv = { APP_VERSION: process.env.APP_VERSION!, APP_BUILT_AT: process.env.APP_BUILT_AT! };

const nextConfig: NextConfig = {
  env: appVersionEnv,
};

export default nextConfig;
