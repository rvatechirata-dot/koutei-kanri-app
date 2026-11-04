# 工程管理（koutei-kanri-app）

受注（エムネットの案件）が、いまどの工程にいるかを一目で見る。川﨑部長の試作（Apps Script 版）を作り直したもの。
仕様は `docs/仕様書.md`。

- 本番URL: https://koutei-kanri-app.rvatec-hirata.workers.dev （2026-11-04 公開・Cloudflare Access で社員のみ）
- 構成: Next.js ＋ Cloudflare Workers（OpenNext）＋ D1（`koutei-kanri-db`）＋ Cloudflare Access

## 手元で動かす

```
npm install
npx wrangler d1 migrations apply koutei-kanri-db --local   # 初回のみ
npm run dev -- -p 3038
```

開発時は画面上部の黄色いバーでユーザー（管理者／一般）を切り替えられる。

## デプロイ

migration は「足すだけ」にし、デプロイの前に `npx wrangler d1 migrations apply koutei-kanri-db --remote` で流す。
`npm run deploy`（関所がコミット漏れ・GitHub とのずれ・流していない migration で止める）。
デプロイ後は、ログインしていない状態で開いてログイン画面に飛ぶか確かめる。
