// リバテック側アカウントへのデプロイ（2026-09-25）。npm run deploy から呼ばれる。
// リバ側に出すのは持ち主（.githooks/owners.txt の平田）だけ。手伝いの人はカワ側（npm run deploy:kwatec）だけ出す。
// デプロイには「どのコミットを・誰が出したか」の印を付ける（scripts/deploy-note.cjs）。
// 2026-10-10〜 ビルドの前に、リバ側のデータベースに流していない migration が無いかを見る（scripts/check-migrations.cjs）。
//   カワ側は川口さんが migration も流すので、カワだけに流れた変更をリバへそのまま出さないため。
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { deployNote, me } = require("./deploy-note.cjs");
const { checkMigrations } = require("./check-migrations.cjs");

// koutei-kanri-app はリバ側だけのアプリなので、手伝いの人（.githooks/helpers.txt の川﨑部長・2026-11-04〜）も出せる。
//   出した内容は毎朝8時のレポートで平田が見る。
const readList = (name) =>
  fs
    .readFileSync(path.join(process.cwd(), ".githooks", name), "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !s.startsWith("#"));
let owners = [];
let helpers = [];
try {
  owners = readList("owners.txt");
} catch {
  // 名簿が読めなければ止めない（Cloudflare 側の権限で止まる）
}
try {
  helpers = readList("helpers.txt");
} catch {
  // 名簿が無ければ手伝いの人はいない扱い
}
if (owners.length > 0 && !owners.includes(me()) && !helpers.includes(me())) {
  console.error("");
  console.error(`  ■ リバテック側へのデプロイは平田と手伝いの人（.githooks/helpers.txt）だけが行えます（打った人：${me()}）`);
  console.error("");
  process.exit(1);
}

checkMigrations({ configFile: "wrangler.jsonc", side: "rvatec" });

const note = deployNote();
console.log(`[deploy] 印：${note}`);
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("npx opennextjs-cloudflare build");
run(`npx opennextjs-cloudflare deploy -- --message "${note}"`);
