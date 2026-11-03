// 本番のデータベースに、まだ流していない migration が無いかを見る（2026-10-10）。
// scripts/deploy-rvatec.cjs と scripts/deploy-kwatec.cjs から、ビルドの前に呼ばれる。
//
// カワ側は川口さんが migration も流すようになった（2026-10-10〜）。プログラムはリバ・カワで1つなので、
// カワだけに流した変更をリバへそのまま出すと、画面だけ先に出て「その項目が無い」エラーになる。その逆も同じ。
//   → migrations/ にあるのに、出す先のデータベースに流れていないものがあれば、デプロイを止める。
//   → 調べられなかったとき（回線・権限など）は、注意だけ出して進む。
//   急ぎの抜け道：ALLOW_UNAPPLIED=1 npm run deploy …（画面が壊れるおそれがあるので原則使わない）
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function dbName(configFile) {
  const cfg = fs.readFileSync(path.join(process.cwd(), configFile), "utf8");
  return (cfg.match(/"database_name"\s*:\s*"([^"]+)"/) || [])[1];
}

function localMigrations() {
  try {
    return fs
      .readdirSync(path.join(process.cwd(), "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

function appliedMigrations(db, configFile, env) {
  const wrangler = path.join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  const args = [wrangler, "d1", "execute", db, "--remote", "--json", "--command", "SELECT name FROM d1_migrations", "-c", configFile];
  const out = execFileSync(process.execPath, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  const json = JSON.parse(out.slice(out.search(/[[{]/)));
  return (Array.isArray(json) ? json : [json]).flatMap((r) => r.results || []).map((r) => r.name);
}

// side: "rvatec" | "kwatec"
function checkMigrations({ configFile, side, env = process.env }) {
  const label = side === "kwatec" ? "カワテック側" : "リバテック側";
  const local = localMigrations();
  if (local.length === 0) return;
  const db = dbName(configFile);
  if (!db) return;
  if (process.env.ALLOW_UNAPPLIED === "1") {
    console.warn(`[check-migrations] ALLOW_UNAPPLIED=1 のため、${label}のデータベースの点検を飛ばします。`);
    return;
  }

  let applied;
  try {
    applied = new Set(appliedMigrations(db, configFile, env));
  } catch (e) {
    console.warn("");
    console.warn(`  ⚠ ${label}のデータベース（${db}）を調べられませんでした。注意だけ出して進みます。`);
    console.warn(`    （${String(e.stderr || e.message).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "理由不明"}）`);
    console.warn("");
    return;
  }

  const missing = local.filter((f) => !applied.has(f));
  if (missing.length === 0) {
    console.log(`[check-migrations] ${label}のデータベース（${db}）：流していない migration はありません`);
    return;
  }

  const cmd = `npx wrangler d1 migrations apply ${db} --remote${configFile === "wrangler.jsonc" ? "" : ` -c ${configFile}`}`;
  console.error("");
  console.error(`  ■ ${label}のデータベース（${db}）に、まだ流していない migration があります。デプロイを止めました`);
  console.error("");
  for (const f of missing) console.error(`    ${f}`);
  console.error("");
  console.error("  このまま出すと、画面だけ先に出て「その項目が無い」エラーになります。");
  if (side === "kwatec") {
    console.error("  先にカワ側のデータベースに流してから、もう一度デプロイしてください：");
    console.error(`    ${cmd}`);
    console.error("  migration は「足すだけ」にする。消す・名前を変えるは、別の回に分けてください。");
  } else {
    console.error("  リバ側のデータベースは平田が流します（カワ側で先に流した migration かもしれません）。");
    console.error("  中身を確かめてから流し、もう一度デプロイしてください：");
    console.error(`    ${cmd}`);
  }
  console.error("");
  process.exit(1);
}

module.exports = { checkMigrations, dbName, localMigrations, appliedMigrations };
