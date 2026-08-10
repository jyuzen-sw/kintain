# 勤怠管理 PoC

スマートフォン中心の従業員向け勤怠操作と、PC中心の管理者向け確認・承認を備えた、ChatGPT Sites-readyな勤怠管理PoCです。メールアドレスとパスワードによるアプリ内認証、Cloudflare D1への永続化、PWA、監査ログを実装しています。

> [!IMPORTANT]
> このリポジトリは **Phase 1（Sites-ready、未デプロイ）** の成果物です。ChatGPT Sitesの作成、実D1の作成・接続、実環境値の設定、バージョン保存、デプロイ、公開URL発行は実施していません。これらは [SITES_DEPLOYMENT_RUNBOOK.md](./SITES_DEPLOYMENT_RUNBOOK.md) に従ってPhase 2で行います。

## 主な機能

- 従業員: 出勤・退勤、GPS取得状態の記録、当日状態、月次実績、本人修正、休暇・欠勤申請、申請取消
- 管理者: 当日・現場別・個人別の実績確認、全期間の実績修正、申請承認・却下、監査ログ、デモデータreset
- 認証・認可: メールアドレス＋パスワード、D1 session、ロール判定、CSRF防御、同一origin検査、ログイン試行制限
- データ: 予定、勤怠実績、打刻イベント、申請、監査、sessionをD1へ保存
- PWA: manifest、Service Worker、オフライン案内、更新通知、safe area対応

認証方式の判断は [ADR 0001](./docs/adr/0001-sites-authentication.md)、画面とデザインは [DESIGN.md](./DESIGN.md)、Phase 2への完全な引き継ぎ情報は [SITES_HANDOFF.md](./SITES_HANDOFF.md) を参照してください。

## 技術構成

- Node.js 22以上
- TypeScript 5.9（strict）
- React 19 / Vinext 1.0.0-beta.5 / Vite 8
- Cloudflare Worker互換ESM / Cloudflare D1 binding `DB`
- Drizzle ORM / Drizzle Kit
- Vitest / Cloudflare Workers Vitest pool / Playwright

OpenAI公式のSites showcaseは、Vinext starter、Cloudflare Worker互換ESM、`.openai/hosting.json`、D1の論理binding `DB`、`db/schema.ts` とmigrationを推奨しています。本リポジトリはこの形に合わせています。[OpenAI Sites showcase: Sparkboard](https://learn.chatgpt.com/showcase/idea-intake)

## ローカル起動

前提はNode.js 22以上とnpmです。

```bash
npm ci
npm run db:reset:local
npm run dev
```

表示されたローカルURLへアクセスします。`db:reset:local` はmigration適用後、ローカルD1のデータを削除して架空データを再投入します。実D1には接続しません。

### 架空デモアカウント

以下は `.example.test` ドメインだけを使う、意図的に公開された架空のPoC用認証情報です。実在人物・実サービスには使用しないでください。

| ロール | メールアドレス | パスワード |
|---|---|---|
| 従業員 | `maru.employee@example.test` | `DemoPass!2026` |
| 従業員 | `batsu.employee@example.test` | `DemoPass!2026` |
| 従業員 | `sankaku.employee@example.test` | `DemoPass!2026` |
| 従業員 | `shikaku.employee@example.test` | `DemoPass!2026` |
| 従業員 | `hishi.employee@example.test` | `DemoPass!2026` |
| 管理者 | `admin@example.test` | `AdminDemo!2026` |

## よく使うコマンド

| コマンド | 用途 |
|---|---|
| `npm run dev` | Vinext開発サーバー |
| `npm run build` | Cloudflare Worker互換の本番build |
| `npm run start` | build済みWorkerをWranglerでローカルpreview |
| `npm run lint` | ESLint |
| `npm run typecheck` | strict TypeScript検査 |
| `npm run test:unit` | 単体テスト |
| `npm run test:integration` | Workers runtime＋ローカルD1の結合テスト |
| `npm run test:e2e` | Playwright E2E |
| `npm run test:coverage` | coverage取得 |
| `npm run db:migrate:local` | `0001_initial.sql`、`0002_request_idempotency.sql`、`0003_demo_seed.sql` を順にローカルD1へ適用 |
| `npm run db:seed:local` | 空のローカルD1へ架空seedを投入 |
| `npm run db:seed:render` | D1へ接続せず、架空seed SQLを検証・再生成するため標準出力へ生成 |
| `npm run db:reset:local` | ローカルD1を初期架空データへ戻す |

`db:seed:local` は既存seedへの重複投入を意図していません。通常は再実行可能な `db:reset:local` を使います。特に、`0003_demo_seed.sql` が未適用で既存データのあるローカルD1には `db:migrate:local` を使わず、`db:reset:local` で安全に初期化してください。

## データと環境設定

- D1 bindingはコード、Wrangler、Sites manifestのすべてで `DB` に固定しています。
- schemaは [`db/schema.ts`](./db/schema.ts)、migrationは [`drizzle/0001_initial.sql`](./drizzle/0001_initial.sql) → [`drizzle/0002_request_idempotency.sql`](./drizzle/0002_request_idempotency.sql) → [`drizzle/0003_demo_seed.sql`](./drizzle/0003_demo_seed.sql) の順です。`0003` は空の実D1へ一度だけ適用する架空デモデータ移行です。
- Sites実環境でschemaだけが存在し架空データ行がない場合は、3つの公開デモgateがすべて有効なときに限り、初回login POSTが8つのアプリ表（rate limit表を除く）の完全な空を確認して既定の架空user・site・当日シナリオを1つのD1 batchで初期化します。部分状態または非空DBは変更せず停止します。
- UTC日時はISO 8601のTEXT、勤務日はAsia/Tokyo基準の `YYYY-MM-DD` で保存します。
- ローカルD1状態、ローカル環境ファイル、実環境値はGit管理しません。
- hosted environment valuesはPhase 2でSitesの設定画面から登録し、値をprompt、添付、manifest、文書、ログへ転記しません。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

環境変数名と用途は [SITES_HANDOFF.md](./SITES_HANDOFF.md#環境変数とsecret) に集約しています。

## PWAの動作

`public/manifest.webmanifest` の開始URLは `/app` です。iconは192×192 PNG、512×512 PNG、maskable 512×512 PNG、Apple touch icon、SVGを用意しています。Service Workerは個人データを含まないアプリシェル、manifest、icon、offlineページと取得済みbuild静的assetをcacheします。認証済みHTML、RSC、APIはcacheせず、画面遷移がnetwork errorになった場合は「保存されていない」ことを明示する汎用シェルを返します。APIと更新系操作はoffline queueへ入れません。接続復旧後に利用者が明示的に再試行します。

## 実装判断

- `punch_events` は打刻事実として変更せず、現在値は `attendance_records`、変更はGPSを含まない可変勤怠項目だけを `audit_logs` へ保存します。
- 打刻、勤怠修正、申請作成・取消・審査はUUIDとDB上のreceiptで冪等化します。同じpayloadの再送は同じ結果、同じUUIDの別操作への流用は409です。画面上で失敗後に入力内容を変えた場合は新しいUUIDへ切り替えます。
- 退勤時の自動休憩は予定値、なければ60分です。ただし勤務経過がそれより短い場合は「休憩は勤務経過以下」という確定制約を守るため、自動値だけを経過分数まで縮めます。利用者が明示入力した過大値は保存を拒否します。
- 公開デモの3つのgateが有効な場合、訪問者の実GPSを端末で取得せず、直接APIへ送られた座標もサーバーで破棄します。通常モードでは任意GPS機能を利用できます。seedの座標は規則的に生成した合成値です。

## テストと引き継ぎ

Phase 1の実行結果、全画面・API route、smoke項目、既知制約は [SITES_HANDOFF.md](./SITES_HANDOFF.md) にあります。Phase 2担当者は作業前に固定コミットとclean worktreeを確認し、全検査を再実行してください。

## 重要な制約

- ChatGPT Sitesはpublic betaです。すべてのデプロイURLはproduction扱いなので、Phase 2ではまずversionを保存してレビューし、承認後にのみdeployします。
- Sitesはローンチ時点でdata residency / inference residencyを提供せず、Site code、D1/R2、生成物、ログも対象です。架空データ以外を投入しません。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)
- Vinext betaが既知advisory対象の `image-size` を固定しています。安全な互換更新が公開されるまでPoC限定です。
- PBKDF2の反復処理と、実D1でのbatch・latency・migration/seed経路はPhase 2の実環境で確認が必要です。
