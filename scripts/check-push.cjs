// push 前の点検（2026-09-23）。.githooks/pre-push から呼ばれる。
// GitHub の無料プランでは「main はプルリクエスト必須」を設定できないので、手元で止める。
// main / master に直接 push できるのは持ち主（.githooks/owners.txt のメール）だけ。
// それ以外の人は自分の枝に送って、GitHub でプルリクエストを出す。
// 2026-09-25〜 手伝いの人（.githooks/helpers.txt のメール）も直接 push できる。
// 2026-10-10〜 カワ側は川口さんがすべて直せる（migration も流せる）。migrations/ 入りも止めずに注意だけ出す。
//   リバ側のデータベースは平田が流す。流し忘れたままリバへ出そうとすると、デプロイ側（scripts/check-migrations.cjs）で止まる。
//
//   node scripts/check-push.cjs --install … この点検を有効にする。npm install のとき自動で動く（package.json の prepare）
//
// うっかり防止のためのもので、わざと飛ばせば飛ばせる。飛ばさないこと。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

if (process.argv.includes("--install")) {
  try {
    git(["config", "core.hooksPath", ".githooks"]);
  } catch {
    // git が無い・リポジトリでない（自動デプロイの組み立て中など）。気にしない
  }
  process.exit(0);
}

function readList(root, name) {
  return fs
    .readFileSync(path.join(root, ".githooks", name), "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !s.startsWith("#"));
}

let owners;
let helpers = [];
try {
  const root = git(["rev-parse", "--show-toplevel"]);
  owners = readList(root, "owners.txt");
  try {
    helpers = readList(root, "helpers.txt");
  } catch {
    // 名簿が無ければ手伝いの人はいない扱い
  }
} catch {
  console.warn("[check-push] .githooks/owners.txt が読めないため、点検を飛ばします。");
  process.exit(0);
}

// 送ろうとしている変更に入っている migrations/ のファイル
function migrationFiles(localSha, remoteSha) {
  const range = /^0+$/.test(remoteSha) ? [localSha, "--not", "--remotes=origin"] : [`${remoteSha}..${localSha}`];
  try {
    return git(["log", "--format=", "--name-only", ...range, "--", "migrations/"])
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((f, i, a) => a.indexOf(f) === i);
  } catch {
    return ["（調べられませんでした）"];
  }
}

let me = "";
try {
  me = (git(["var", "GIT_AUTHOR_IDENT"]).match(/<([^>]*)>/) || [])[1].toLowerCase();
} catch {
  // 分からなければ持ち主ではない扱い
}

const input = fs.readFileSync(0, "utf8");
for (const line of input.split(/\r?\n/)) {
  const [, localSha, remoteRef, remoteSha] = line.split(" ");
  if (remoteRef !== "refs/heads/main" && remoteRef !== "refs/heads/master") continue;
  if (owners.includes(me)) continue;

  const branch = remoteRef.replace("refs/heads/", "");
  if (helpers.includes(me)) {
    if (/^0+$/.test(localSha)) continue; // 枝を消すだけ
    const mig = migrationFiles(localSha, remoteSha);
    if (mig.length === 0) continue;
    // koutei-kanri-app はリバ側だけ
    console.warn("");
    console.warn(`  ■ データベースの形を変える変更（migration）が入っています（${branch} に送ります）`);
    console.warn("");
    for (const f of mig) console.warn(`    ${f}`);
    console.warn("");
    console.warn("  デプロイする前に、データベースに流してください（逆にすると「その項目が無い」エラーで止まります）：");
    console.warn("    echo y | npx wrangler d1 migrations apply koutei-kanri-db --remote");
    console.warn("  （-y を付けると失敗して何も流れません。echo y | で流す）");
    console.warn("  migration は「足すだけ」にする。消す・名前を変えるは、別の回に分けてください。");
    console.warn("");
    continue;
  }

  console.error("");
  console.error(`  ■ ${branch} には直接送れません（送ろうとした人：${me || "不明"}）`);
  console.error("");
  console.error("  自分の枝を作ってから送り、GitHub でプルリクエストを出してください：");
  console.error("    git switch -c <作業の名前>");
  console.error("    git push -u origin <作業の名前>");
  console.error("");
  console.error("  分からないときは平田に聞いてください。");
  console.error("");
  process.exit(1);
}
