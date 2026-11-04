# koutei-kanri-app（工程管理）

- 受注（エムネットの案件）が、いまどの工程にいるかを一目で見るアプリ。川﨑部長の試作「工程管理（エムネット置き換え 試作①）」7段目c（Apps Script・画面の版0.7.2）を、社内ルールの構成（Next.js＋Cloudflare Workers＋D1＋Access）で作り直している。
- 仕様は `docs/仕様書.md`。直したら仕様書も直す。試作のコードの読み解き（列の位置・取り込みのきまり・行番号つき）は `docs/川﨑版7cの読み解き.md`。
- リバテック側だけのアプリ。本番＝`npm run deploy`。開発＝`npm run dev -- -p 3038`。
- データベース＝`koutei-kanri-db`（このアプリ）と `master-db`（全社マスタ・名前を引くために**読むだけ**）。
- **日時はデータベースにも日本時間の文字で入れる**（'YYYY/MM/DD HH:MM'。エムネット・試作と同じ形）。datetime('now') は使わず `src/lib/kotei/time.ts` の `nowJst()`。表示で9時間足さない。
- 数（数量・単価）も文字で持つ（取り込みで「10」と「10.0」を正しく比べるため）。足すときは CAST。
- 取り込みの比べ方は試作と同じにしてある（`src/lib/kotei/csv.ts`・`importer.ts`・`rules.ts`）。変えるときは試作の手順書（共有 `営業部\Claude\工程管理_エムネットCSV毎日取り込み手順_20261022_川崎.md`）とずれないか見る。
- D1 の書き込みの枠（1日10万行）を食わないよう、取り込みは変わった品目だけ書く。全消し→入れ直しをしない。
- 管理者（CSV取り込み・作業ログCSV・在庫の数を直す・基本の一覧・案件の登録と修正・ガントの予定の変更・操作ログ・ほかの人の作業を直す）＝`wrangler.jsonc` の `ADMIN_EMAILS`。ほかの社員は見る・工程の開始/完了/作業を押す。
- 作業者＝ログインした人（`/api/acts`）。開始・完了・作業のきまりは `src/lib/kotei/acts.ts`（試作の applyActs_ と同じ）。在庫の数え方は `src/lib/kotei/stock.ts`（試作の buildStock）、作業ログCSVは `src/lib/kotei/worklog.ts`。
- 画面の作り：WEBデザインルール（本文16px・比 4.5:1 以上・強調色は青1色・状態は色＋字）。
- 単価・客先名が入る（社外に出さない情報）。このアプリを直す作業は Claude Opus で行う。

## 手伝いの人＝川﨑部長（2026-11-04〜）
- `.githooks/helpers.txt` の人（川﨑部長 kawasaki-yu@rvatec.com）は、平田の承認なしで直してよい：コード・main への直接 push・リバ側へのデプロイ（`npm run deploy`）。
- **git のメールは kawasaki-yu@rvatec.com にする**（`git config user.email`）。違うメールだと push もデプロイも止まる。
- 作業の順番：**作業前に `git pull` → 直す → `npm run dev` で確かめる → コミット → `git push` → `npm run deploy`**。デプロイ前の関所（`scripts/check-clean.cjs`）が、コミットしていない変更や GitHub とのずれで止める。止まったら、他の人（平田）の作りかけかもしれないので勝手にコミットせず、平田に聞く。
- **デプロイしたら、ログインしていない状態で開いてログイン画面に飛ぶか確かめる**（`curl -s -o /dev/null -w "%{http_code}" https://koutei-kanri-app.rvatec-hirata.workers.dev/` が 302）。確かめるまで「公開した」と言わない。
- **データベースの形の変更（`migrations/`）は川﨑部長も流してよい**（Cloudflare リバの Workers Platform Admin・2026-11-03〜）。順番は「`echo y | npx wrangler d1 migrations apply koutei-kanri-db --remote` → `npm run deploy`」（`-y` を付けると失敗して何も流れない）。**足すだけ**にする（消す・名前を変えるは別の回に分ける）。流していないとデプロイは止まる（`scripts/check-migrations.cjs`）。
- データを直接直す（`wrangler d1 execute koutei-kanri-db --remote`）ときは、消す・まとめて書き換える前に、その行を書き出して控えを取る。
- **Cloudflare の権限はリバのアカウント全体に効く**（他のアプリ・全社マスタなどのデータベースも見えて消せる）。**koutei-kanri-app と koutei-kanri-db 以外には触らない。** 他のアプリのコマンドを打たない。
- **触らないもの**：`.githooks/`・`scripts/`（点検の仕組み）・`wrangler.jsonc` の `ADMIN_EMAILS`・`account_id`（出す先をリバのアカウントに固定している）・データベースの設定。Cloudflare Access（ログインの関所）とメンバー管理は平田だけ。
- `master-db` には書き込まない（ログインした人の名前を引くだけ）。
- 変更は毎朝8時のレポート（平田のPC `01_アプリ\カワ側アプリ変更レポート`）で平田が見る。
