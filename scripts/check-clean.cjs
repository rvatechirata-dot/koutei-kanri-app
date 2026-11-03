// デプロイ前の「関所」（2026-09-11）。
// このアプリは「作業フォルダの中身をそのまま本番に出す」ので、コミットしていない変更が
// あるままデプロイすると、本番とGitHubがずれたまま残る（2026-09-11の点検で4本中3本に発生）。
// ここで止めて、先にコミットしてもらう。
//
//   止まったときの出口は2つ
//     1) 先にコミットする（ふつうはこちら）
//     2) 作りかけのまま試したいときだけ  ALLOW_DIRTY=1 npm run deploy
//
// git が無い・リポジトリでない場合は止めない（警告だけ）。
// 後半で GitHub との照合もする（下の「GitHub との照合」を参照）。
const { execSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(args) {
  return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

let status;
try {
  status = git("status --porcelain");
} catch {
  console.warn("[check-clean] git が使えないため、コミット状態の確認を飛ばします。");
  process.exit(0);
}

if (status && process.env.ALLOW_DIRTY !== "1") {
  console.error("");
  console.error("┌──────────────────────────────────────────────────────┐");
  console.error("│ デプロイを止めました：コミットしていない変更があります │");
  console.error("└──────────────────────────────────────────────────────┘");
  console.error(status.split("\n").map((l) => "  " + l).join("\n"));
  console.error("");
  console.error("  本番とGitHubがずれないよう、先にコミットしてください。");
  console.error("  作りかけのまま試すときだけ：  ALLOW_DIRTY=1 npm run deploy");
  console.error("");
  process.exit(1);
}

if (status) {
  console.warn("[check-clean] ALLOW_DIRTY=1 のため、コミットしていない変更があるまま進めます。");
}

// ── ここから GitHub との照合（2026-09-23 追加）──
// 2人で触るようになったので、「GitHub の方が新しいのに古い手元から出す」と
// 相手の変更が本番から消える。デプロイの前に GitHub と手元をそろえてもらう。
//
//   止まったときの出口
//     1) 表示どおり git pull / git push をする（ふつうはこちら）
//     2) どうしても今出す必要があるときだけ  ALLOW_UNSYNCED=1 npm run deploy
//
// GitHub につながらないときは止めない（警告だけ）。
function stop(title, lines) {
  console.error("");
  console.error(`  ■ デプロイを止めました：${title}`);
  console.error("");
  for (const l of lines) console.error("  " + l);
  console.error("");
  console.error("  どうしても今出す必要があるときだけ：  ALLOW_UNSYNCED=1 npm run deploy");
  console.error("");
  process.exit(1);
}

if (process.env.ALLOW_UNSYNCED === "1") {
  console.warn("[check-clean] ALLOW_UNSYNCED=1 のため、GitHub との照合を飛ばします。");
  process.exit(0);
}

// 本線以外（試し用の枝など）から本番に出さない。本線の名前はアプリにより main か master
const branch = git("rev-parse --abbrev-ref HEAD");
if (branch !== "main" && branch !== "master") {
  stop(`今の作業の枝が本線（main / master）ではありません（${branch}）`, [
    "本番に出せるのは本線だけです。",
    "本線に戻すには：  git switch main  （master のアプリは git switch master）",
  ]);
}

// GitHub の最新状態を取りに行く
try {
  execSync("git fetch --quiet origin", { stdio: "ignore", timeout: 20000 });
} catch {
  console.warn("[check-clean] GitHub につながらないため、最新かどうかを確かめられませんでした。");
  console.warn("[check-clean] 他の人が GitHub に入れた変更が無いか、気をつけてください。");
  process.exit(0);
}

let ahead, behind;
try {
  behind = Number(git("rev-list HEAD..@{u} --count")); // GitHub にだけある
  ahead = Number(git("rev-list @{u}..HEAD --count")); // 手元にだけある
} catch {
  console.warn("[check-clean] GitHub 側の main が見つからないため、照合を飛ばします。");
  process.exit(0);
}

// GitHub にだけある変更を一覧にする（2026-09-23 追加）。
// 無料プランではプルリクエストを強制できないので、持ち主（.githooks/owners.txt）以外の人が
// プルリクエストを通さずに入れた変更・自分で取り込んだ変更に ⚠ を付けて、中身を見てから pull してもらう。
function incoming() {
  const owners = new Set();
  try {
    const root = git("rev-parse --show-toplevel");
    for (const s of fs.readFileSync(path.join(root, ".githooks", "owners.txt"), "utf8").split(/\r?\n/)) {
      const t = s.trim().toLowerCase();
      if (t && !t.startsWith("#")) owners.add(t);
    }
  } catch {}
  try {
    const m = execFileSync("git", ["var", "GIT_AUTHOR_IDENT"], { encoding: "utf8" }).match(/<([^>]*)>/);
    if (m) owners.add(m[1].toLowerCase()); // 自分の変更には付けない
  } catch {}

  const log = (args) =>
    execFileSync("git", ["log", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\x1f"));
  const lines = [];
  let warn = 0;
  const rows = log(["--first-parent", "--date=format:%m/%d", "--format=%P%x1f%ae%x1f%an%x1f%cn%x1f%ad%x1f%s", "HEAD..@{u}"]);
  for (const [parents, ae, an, cn, ad, s] of rows.reverse()) {
    const p = parents.split(" ");
    const pr = s.match(/^Merge pull request #(\d+)/);
    if (p.length > 1 && pr) {
      const inner = log(["--format=%an%x1f%s", `${p[0]}..${p[1]}`]).reverse();
      const by = owners.has(ae.toLowerCase()) ? "" : `   ⚠ 取り込んだのが持ち主以外（${an}）`;
      if (by) warn++;
      lines.push(`・${ad} プルリクエスト #${pr[1]} で取り込み済み${by}`);
      for (const [who, t] of inner) lines.push(`     - ${who}  ${t}`);
    } else if (cn === "GitHub" && /\(#\d+\)$/.test(s)) {
      lines.push(`・${ad} ${an}  ${s}  （プルリクエストで取り込み済み）`);
    } else if (owners.has(ae.toLowerCase())) {
      lines.push(`・${ad} ${an}  ${s}`);
    } else {
      warn++;
      lines.push(`・${ad} ${an}  ${s}   ⚠ プルリクエストを通っていません`);
    }
  }
  return { lines, warn };
}

if (behind > 0) {
  let list = [];
  try {
    const { lines, warn } = incoming();
    list = ["", "  手元に無い変更：", ...lines.map((l) => "  " + l), ""];
    if (warn > 0) list.push(`⚠ の ${warn} 件は、確認されていない可能性があります。中身を見てから pull してください。`, "");
  } catch {
    // 一覧が作れなくても、止めることは変えない
  }
  stop(`GitHub の方が新しくなっています（手元に無い変更が ${behind} 件）`, [
    "このまま出すと、その変更が本番から消えます。",
    ...list,
    "先に最新をもらってきてください：  git pull",
    ...(ahead > 0 ? [`（手元にも push していない変更が ${ahead} 件あります。pull のあと push してください）`] : []),
  ]);
}

if (ahead > 0) {
  stop(`まだ GitHub に送っていない変更が ${ahead} 件あります`, [
    "本番と GitHub がずれないよう、先に送ってください：  git push",
  ]);
}

console.log("[check-clean] GitHub と同じ最新の状態です。デプロイを続けます。");
