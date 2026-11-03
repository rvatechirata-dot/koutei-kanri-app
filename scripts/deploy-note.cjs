// デプロイに付ける「印」（2026-09-25）。
// 本番の版ごとに「どのコミットを・誰が出したか」を Cloudflare に残す。
// 毎朝8時のレポート（01_アプリ\カワ側アプリ変更レポート）がこれを読んで GitHub と突き合わせる。
//   例） git:a59e381,by:kawaguchi@kwatec.com
//   コミットしていない変更があるまま出した → 末尾に ,dirty
//   GitHub に送っていないコミットがあるまま出した → 末尾に ,unpushed（空白は使わない。opennext が引数を空白で切るため）
const { execFileSync } = require("node:child_process");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function me() {
  try {
    return ((git(["var", "GIT_AUTHOR_IDENT"]).match(/<([^>]*)>/) || [])[1] || "unknown").toLowerCase();
  } catch {
    return "unknown";
  }
}

function deployNote() {
  let head = "unknown";
  const flags = [];
  try {
    head = git(["rev-parse", "--short=7", "HEAD"]);
    if (git(["status", "--porcelain"])) flags.push("dirty");
    if (Number(git(["rev-list", "@{u}..HEAD", "--count"])) > 0) flags.push("unpushed");
  } catch {
    flags.push("nogit");
  }
  return [`git:${head}`, `by:${me()}`, ...flags].join(",");
}

module.exports = { deployNote, me };
