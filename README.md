# 勤怠管理 PoC

スマートフォン中心の従業員向け勤怠操作と、PC中心の管理者向け確認・承認を備えた勤怠管理PoCです。メールアドレスとパスワードによるアプリ内認証、Cloudflare D1への永続化、PWA、監査ログを実装し、ChatGPT Sitesでホストできる構成にしています。

## 主な機能

- 従業員: 出勤・退勤、当日状態、月次実績、本人修正、休暇・欠勤申請、申請取消
- 管理者: 当日・現場別・個人別の実績確認、勤務予定管理、実績修正、申請承認・却下、監査ログ、デモデータreset
- 認証・認可: D1 session、ロール判定、CSRF防御、同一origin検査、ログイン試行制限
- データ: 勤務予定、勤怠実績、打刻イベント、申請、監査、sessionをD1へ保存
- PWA: manifest、Service Worker、オフライン案内、更新通知、safe area対応

## 技術構成

- Node.js 22以上 / npm
- TypeScript / React / Vinext / Vite
- Cloudflare Worker互換ESM / Cloudflare D1
- Drizzle ORM / Drizzle Kit
- Vitest / Cloudflare Workers Vitest pool / Playwright

依存関係の正確なバージョンと実行スクリプトは[`package.json`](./package.json)を正本とします。

## ローカル起動

```bash
npm ci
npm run db:reset:local
npm run dev
```

表示されたローカルURLへアクセスします。`db:reset:local`はmigrationを適用し、ローカルD1を架空デモデータへ戻します。実D1には接続しません。

### 架空デモアカウント

`.example.test`ドメインだけを使う、意図的に公開されたPoC用認証情報です。実在人物や実サービスには使用しないでください。

| ロール | メールアドレス | パスワード |
| --- | --- | --- |
| 従業員 | `maru.employee@example.test` | `DemoPass!2026` |
| 従業員 | `batsu.employee@example.test` | `DemoPass!2026` |
| 従業員 | `sankaku.employee@example.test` | `DemoPass!2026` |
| 従業員 | `shikaku.employee@example.test` | `DemoPass!2026` |
| 従業員 | `hishi.employee@example.test` | `DemoPass!2026` |
| 管理者 | `admin@example.test` | `AdminDemo!2026` |

## よく使うコマンド

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバーを起動する |
| `npm run build` | Cloudflare Worker互換の本番buildを作る |
| `npm run start` | build済みWorkerをローカルpreviewする |
| `npm run lint` | ESLintを実行する |
| `npm run typecheck` | strict TypeScript検査を実行する |
| `npm run test:unit` | 単体テストを実行する |
| `npm run test:integration` | Workers runtimeとローカルD1の結合テストを実行する |
| `npm run test:e2e` | Playwright E2Eを実行する |
| `npm run test:coverage` | test coverageを取得する |
| `npm run db:migrate:local` | 未適用のmigrationをローカルD1へ適用する |
| `npm run db:seed:local` | 空のローカルD1へ架空データを投入する |
| `npm run db:reset:local` | ローカルD1を初期架空データへ戻す |

`db:seed:local`は既存seedへの重複投入を想定していません。通常の再初期化には`db:reset:local`を使用してください。

## 設定とデータ

- D1 bindingはコード、Wrangler、Sites manifestのすべてで`DB`に固定しています。
- schemaは[`db/schema.ts`](./db/schema.ts)、前進migrationは[`drizzle/`](./drizzle/)を正本とします。
- 公開デモは`DEMO_MODE`、`ALLOW_PUBLIC_DEMO`、`SHOW_DEMO_CREDENTIALS`がすべて`true`のときだけ有効です。ローカル用の設定例は[`.dev.vars.example`](./.dev.vars.example)にあります。
- 3つの設定はデモ表示・初期化・resetを許可するgateであり、公開済みcredentialの失効機構ではありません。
- 公開デモでは訪問者端末の位置情報を取得せず、APIへ直接送られた座標も保存しません。通常モードでは任意GPS機能を利用できます。
- ローカルD1状態、`.dev.vars`、hosted environment valuesはGit管理しません。

## 設計上の要点

- `punch_events`は打刻事実として変更せず、現在値を`attendance_records`、変更履歴を`audit_logs`へ保存します。
- 打刻、勤怠修正、申請、勤務予定の更新系操作はclient request IDとDB上のreceiptで冪等化します。同じIDを異なる操作へ流用した場合は競合として拒否します。
- 勤務予定はversionで競合を検出し、打刻・入力済み実績・処理中または承認済み申請がある日の不整合な変更を拒否します。
- 認証にはD1上のopaque sessionを使用し、Sitesの共有範囲とアプリ内の従業員・管理者権限を分離します。
- Service Workerは認証済みHTML、API、更新操作をcacheまたはoffline queueへ入れません。

## ドキュメント

- [デザイン方針](./docs/design.md)
- [ADR 0001: Sites公開デモでもアプリ内loginとD1 sessionを使う](./docs/adr/0001-sites-authentication.md)
- [ADR 0002: 公開デモだけPBKDF2コストをSites実行上限へ合わせる](./docs/adr/0002-sites-public-demo-password-cost.md)
- [ChatGPT Sites運用ガイド](./docs/operations/sites.md)

## PoCとしての制約

- 架空データだけを扱う公開デモ用途を前提とし、実在従業員の個人情報や実credentialを投入しません。
- 通常環境の新規password hashはPBKDF2-SHA-256の600,000反復です。Sites向け公開デモの既知accountだけは実行上限に合わせて100,000反復とします。判断と境界はADR 0002を参照してください。
- password reset、email verification、MFA、account provisioning、期限切れsessionの定期cleanupは対象外です。
- ChatGPT Sitesの提供範囲や制限は変わり得るため、公開作業前に[公式ドキュメント](https://learn.chatgpt.com/docs/sites)を確認してください。
