# ChatGPT Sites Phase 1 → Phase 2 引き継ぎ

## 1. 引き継ぎ状態

この成果物は **Phase 1のSites-ready実装であり、未デプロイ** です。Phase 1では次を一切実施していません。

- ChatGPT Sites上のSite作成・選択
- 実D1の作成、削除、binding
- hosted environment valuesやSecretの登録
- Sites versionの保存、deploy、再deploy、rollback
- 共有範囲変更、一般公開URL発行

引き渡し対象:

| 項目 | 値 |
|---|---|
| リポジトリ | `kintain`（この環境ではremote未設定） |
| ローカルパス | `/repository/kintain` |
| ブランチ | `main` |
| 検証済み実装コミット | `d9e68606f9bf3a762fbcea4d72d77e3ea4fbef5a` |
| 最終引き渡しHEAD | 上記実装コミットへ、このSHA記録だけを加えた直後の文書コミット |
| Node.js | 22以上 |
| package manager | npm（`package-lock.json` を正とする） |

コミットは自身のSHAを内容に含められないため、最終引き渡しHEADは上記実装コミットの直後にある文書専用コミットです。Phase 2は最終HEADを取得し、`git rev-parse HEAD^` が上記SHAで、worktreeがcleanであることを確認してください。不一致、未コミット変更、必須文書の欠落、検査失敗があればdeployせず、状態を記録して原因を切り分けます。

## 2. Sites適合形

- Vinext 1.0.0-beta.5とReact 19によるfull-stack TypeScript
- ViteとCloudflare pluginによるWorker互換ESM build
- Worker entry: `vinext/server/fetch-handler`
- D1の論理binding: `DB`
- R2: 未使用
- Sites manifest: `.openai/hosting.json`
- Drizzle schema: `db/schema.ts`
- migration: `drizzle/0001_initial.sql` → `drizzle/0002_request_idempotency.sql` → `drizzle/0003_demo_seed.sql`（`0003`はPhase 2互換性commitで追加した空D1用の架空データmigration）
- D1取得箇所: `lib/server/db.ts` に集約

OpenAI公式showcaseも、SitesのVinext starter、Worker互換ESM、D1 `DB`、R2なし、Drizzle schema/migration、binding helperを示しています。[OpenAI Sites showcase: Sparkboard](https://learn.chatgpt.com/showcase/idea-intake)

`.openai/hosting.json` はPhase 1では `project_id` を持ちません。公式ドキュメントでは、新規のローカルstarterは `project_id` なしで開始でき、Sitesがhosted projectをprovisionした後に追加すると説明されています。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 3. Phase 1検証記録

以下はPhase 1固定直前の最終記録です。Phase 2は結果にかかわらず全コマンドを再実行します。

| 検査 | コマンド | 現時点の結果 |
|---|---|---|
| install | `npm ci` | 成功（321 packages） |
| typecheck | `npm run typecheck` | 成功 |
| unit | `npm run test:unit` | 79件成功 |
| integration | `npm run test:integration` | 13件成功 |
| local migration | `npm run db:migrate:local` | `0001_initial.sql` → `0002_request_idempotency.sql` 適用成功 |
| local reset/seed | `npm run db:reset:local` | 成功 |
| lint | `npm run lint` | 成功 |
| production build | `npm run build` | 成功 |
| E2E | `npm run test:e2e` | 14/14成功（functional 10件＋visual 4 project） |
| visual QA | Playwright対象viewport＋手動確認 | 4 viewport×10画面＝40 PNG。代表6画面で横overflow・未完了loading・表示崩れなし |
| production依存監査 | `npm audit --omit=dev` | Vinext固定依存に既知high 3件。既知制約へ記録済み |

上表はPhase 1時点の履歴です。Phase 2では実D1 bootstrapのため `0003_demo_seed.sql` とローカル互換性修正を独立commitへ追加しました。さらに初回実deployでschemaは利用できる一方、正しい架空資格情報が401となりました。原因はSites本番workerdがPBKDF2を100,000反復までに制限し、Phase 1の600,000反復hashを `verifyPassword()` が例外から不一致へ変換していたことです。公開デモgate下の空D1初期化、同梱seedの厳密整合、既知の旧hashだけの一度限りの互換更新を分離し、全検査と実URL再検証を `SITES_DEPLOYMENT_RESULT.md` に記録します。

Phase 2の再現順:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run db:reset:local
npm run db:seed:render
npm run test:e2e
npm run build
```

build後のローカルpreviewは `npm run start` です。

## 4. D1

### 4.1 bindingとmigration

binding名は `DB` から変更しません。実resource IDはリポジトリへ書きません。

適用順は次の3本です。順序を入れ替えたり、途中を省略したりしません。

1. `drizzle/0001_initial.sql`
2. `drizzle/0002_request_idempotency.sql`
3. `drizzle/0003_demo_seed.sql`

`0001`は9テーブルの基礎schema、`0002`は既存の`0001`適用済みD1を前進させるmigrationです。`attendance_requests.creation_request_id`を必須・一意として追加し、`audit_logs.mutation_id`をnullable一意として追加します。`0003`はschemaを変えず、レビュー済みの架空データを空D1へ一度だけ投入します。fresh D1には必ず3本を順に適用し、既存データ入りD1へ`0003`を適用しません。

migrationは以下の9テーブル、外部キー、CHECK、検索index、冪等性receipt・楽観lock向け制約を作成します。

| テーブル | 用途 |
|---|---|
| `users` | 架空ユーザー、role、password hash |
| `work_sites` | 架空現場 |
| `work_schedules` | JST勤務日ごとの予定 |
| `attendance_records` | 修正後の現在実績とversion |
| `punch_events` | 上書きしない打刻事実とGPS取得状態 |
| `attendance_requests` | 休暇・欠勤申請と審査状態、作成・判断の冪等性receipt |
| `audit_logs` | 修正、承認、却下、取消、resetの監査と勤怠修正receipt（GPSは保存しない） |
| `sessions` | hash化したsession/CSRF tokenと有効期限 |
| `login_rate_limits` | account・IP fingerprint単位の試行制限 |

日時はUTC ISO 8601のTEXT、`work_date` はAsia/Tokyo基準の `YYYY-MM-DD` です。

### 4.2 ローカルmigration・seed・reset

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:render
npm run db:reset:local
```

- `db:migrate:local`: pending migrationのみをローカルD1へ適用します。`0003`がpendingの既存データ入りDBでは使わず、`db:reset:local`を使います。
- `db:seed:local`: 全migrationを適用し、空ローカルDBへ6ユーザー、2現場、予定、勤務状態、GPS状態、申請3状態、監査例を動的に投入します。非空DBへの重複投入は明示的に拒否します。
- `db:seed:render`: D1へ接続せず、同じ架空seedをSQLとして標準出力へ生成します。Phase 2では生成物をレビューし、その固定結果を `0003_demo_seed.sql` として同梱します。
- `db:reset:local`: 既存ローカルデータを外部キー順に空にし、全migrationを適用した後、固定migration seedを動的な当日データへ置き換えます。
- `LOCAL_DEMO_EMPLOYEE_PASSWORD` と `LOCAL_DEMO_ADMIN_PASSWORD` はローカルseedの上書き専用です。hosted環境へ登録しません。

`seed` と `reset` subcommandは意図的にWranglerの `--local` だけを使用します。`render` subcommandはD1へ接続しません。実D1への第一経路は、Sites標準packageに同梱した `0001` → `0002` → `0003` です。Sites connectorは物理D1名、migration履歴、SQL実行を公開しないため、初回login POSTの `lib/server/demo-bootstrap.ts` が実URLから状態を検証します。3つの公開デモgateが有効で、8つのアプリ表（`login_rate_limits`を除く）が完全に空なら原子的batchで初期化します。既に `0003` の固定seedがある場合は、全テーブル件数と既知IDが厳密一致するときだけ、100,000反復の公開デモ資格情報と実行日シナリオへ一度だけ整合します。旧600,000反復hashで整合済みの場合も、全6件のdirectory値・旧hash・初期化監査・sessionなしが完全一致するときだけ、勤怠をresetせずhashを更新します。いずれも通常INSERTの一意markerで遅い並行batch全体をrollbackし、完成状態を再照会できた場合だけno-opとして続行します。任意の既存userはno-op、userなしの部分状態は503で停止し、既存データを変更しません。ローカルscriptをremote向けに変更しないでください。

### 4.3 アプリ内reset

`POST /api/admin/reset` は管理者session、CSRF、同一originに加え、`DEMO_MODE`、`ALLOW_PUBLIC_DEMO`、`SHOW_DEMO_CREDENTIALS` の3つのgateをすべて要求します。これは既存の架空ユーザー・現場・管理者sessionを維持しつつ、予定、勤怠、打刻、申請、監査例を初期状態へ戻す公開デモ運用向け処理です。ローカルDB全体を作り直す `db:reset:local` とは異なります。

実装は多数のprepared statementをD1 `batch()`へ渡します。ローカルMiniflareでの成功は実D1の制限、latency、失敗時挙動を保証しないため、Phase 2で必ず実測します。

## 5. 環境変数とSecret

この表は **hosted環境で設定する名称と用途だけ** を示します。hosted実値やSecretはこの文書、Git、prompt、添付、ログ、`.openai/hosting.json` に残しません。`.dev.vars.example` の3つの `true` は、Secretではない公開ローカルデモ設定例です。Sites公式もhosted environment valuesはSite settingsで管理し、manifestへ保存しないよう案内しています。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

| 名称 | 配置 | 用途・現在の実装状態 |
|---|---|---|
| `DEMO_MODE` | Sites runtime environment | 架空account表示と管理者用HTTP resetに必要な第1gate |
| `ALLOW_PUBLIC_DEMO` | Sites runtime environment | 架空account表示と管理者用HTTP resetに必要な公開承認gate |
| `SHOW_DEMO_CREDENTIALS` | Sites runtime environment | 架空account表示と管理者用HTTP resetに必要な第3gate |
| `LOCAL_DEMO_EMPLOYEE_PASSWORD` | ローカルprocessのみ | 従業員seed passwordのローカル上書き。Sitesへ設定しない |
| `LOCAL_DEMO_ADMIN_PASSWORD` | ローカルprocessのみ | 管理者seed passwordのローカル上書き。Sitesへ設定しない |

架空account表示と管理者用HTTP resetは、3つのruntime gateがすべて有効な場合だけ許可されます。どれか1つでも満たさない通常モードでは無効です。

この3つのgateはcredential入力補助、空D1の初回架空bootstrap、厳密に識別した同梱seedの一度限りの整合、HTTP reset、公開デモのGPS破棄を制御するもので、login APIや公開済みseed credential自体を無効化しません。空D1 bootstrapは8つのアプリ表が空のときだけ、同梱seed整合は全件数と既知IDが `0003` と完全一致するときだけ動き、それ以外の部分状態または非空DBには触れません。`login_rate_limits` は初回401からの復旧のため空判定対象外ですが、一意markerを保持します。Siteのaccessを一般公開する場合は3つのgateをすべて有効にする明示承認が必要です。それ以外はowner/admin限定を維持します。公開credentialを使わない運用へ変える場合は、非公開credentialの安全な投入・rotationを別実装としてreviewします。

同じ3つのgateが有効な公開デモでは、訪問者端末のgeolocation APIを呼ばず、直接打刻APIへ送られた座標もサーバー側で破棄します。通常モードだけが任意GPS取得を行います。seedに含む座標は規則的に生成した合成値です。

現在のD1 opaque session方式では、Sitesへ登録するSecretはありません。Phase 2の互換修正で新たなSecretが必要になった場合も、名称だけを文書化し、実値はSites settingsだけで管理します。

## 6. 架空デモアカウント

以下だけが意図的な公開値です。すべて架空で、予約済みの `.example.test` を使用します。

| role | email | password | 初期シナリオ |
|---|---|---|---|
| employee | `maru.employee@example.test` | `DemoPass!2026` | 出勤済み、前日修正例 |
| employee | `batsu.employee@example.test` | `DemoPass!2026` | 退勤済み、GPS拒否・timeout例 |
| employee | `sankaku.employee@example.test` | `DemoPass!2026` | 出勤前、却下申請例 |
| employee | `shikaku.employee@example.test` | `DemoPass!2026` | 出勤前、申請中例 |
| employee | `hishi.employee@example.test` | `DemoPass!2026` | 病欠承認済み |
| admin | `admin@example.test` | `AdminDemo!2026` | 管理画面、審査、reset |

通常のメールアドレス＋パスワードAPIを通して認証し、account選択だけでsessionを発行しません。

## 7. 画面route

| route | 対象 | 内容 |
|---|---|---|
| `/` | 共通 | `/app` へredirect |
| `/login` | 未認証 | アプリlogin、許可時のみ架空account入力補助 |
| `/app` | 従業員 | 本日の予定・実績、出退勤 |
| `/me/history` | 従業員 | 自分の月次実績、実績修正 |
| `/me/requests` | 従業員 | 自分の申請一覧、作成、取消 |
| `/admin` | 管理者 | `/admin/today` へredirect |
| `/admin/today` | 管理者 | 日別の全従業員実績 |
| `/admin/sites` | 管理者 | 日付・現場別実績 |
| `/admin/requests` | 管理者 | 申請一覧、承認、却下 |
| `/admin/users` | 管理者 | 従業員選択 |
| `/admin/users/:userId` | 管理者 | 対象従業員の月次実績、修正 |
| `/admin/audit` | 管理者 | 監査ログ |

## 8. API route

成功は原則 `{ "data": ... }`、失敗は `{ "error": { "code", "message", "details", "fieldErrors" } }` です。JSONは`no-store`です。更新系は同一originを検査し、login以外は該当roleのsessionとCSRF tokenを要求します。

| method | route | 認可 | 用途 |
|---|---|---|---|
| `POST` | `/api/auth/login` | 未認証 | email/password認証、session・CSRF cookie発行 |
| `GET` | `/api/auth/session` | session | 現在のuser |
| `POST` | `/api/auth/logout` | session時CSRF | session削除、cookie失効 |
| `GET` | `/api/demo/config` | 公開 | gate未成立時は無効状態、成立時だけ架空account一覧 |
| `GET` | `/api/me/today` | employee | 本日の予定・実績・申請状態 |
| `POST` | `/api/me/punch` | employee | 出退勤。UUID冪等keyとGPS取得状態を保存 |
| `GET` | `/api/me/attendance?month=YYYY-MM` | employee | 自分の月次実績 |
| `PATCH` | `/api/me/attendance/:recordId` | employee本人 | 自分の時刻・休憩・備考修正、version・UUID検査 |
| `GET` | `/api/me/attendance/:recordId/audit` | employee本人 | 自分の対象実績についてGPSを含まない項目別修正履歴 |
| `GET` | `/api/me/requests` | employee | 自分の申請一覧 |
| `POST` | `/api/me/requests` | employee | UUID必須の休暇・欠勤申請作成 |
| `POST` | `/api/me/requests/:requestId/withdraw` | employee本人 | pending申請取消、version・UUID検査 |
| `GET` | `/api/admin/today?date=YYYY-MM-DD` | admin | 日別一覧、従業員・現場候補 |
| `GET` | `/api/admin/sites?date=YYYY-MM-DD&siteId=...` | admin | 現場別一覧 |
| `GET` | `/api/admin/requests` | admin | 全申請一覧 |
| `POST` | `/api/admin/requests/:requestId/approve` | admin | 申請承認、version・UUID冪等key検査 |
| `POST` | `/api/admin/requests/:requestId/reject` | admin | 申請却下、任意コメント・version・UUID冪等key検査 |
| `GET` | `/api/admin/users` | admin | 従業員一覧 |
| `GET` | `/api/admin/users/:userId/attendance?month=YYYY-MM` | admin | 対象者の月次実績 |
| `PATCH` | `/api/admin/attendance/:recordId` | admin | 時刻・休憩・区分修正、理由・version・UUID必須 |
| `GET` | `/api/admin/audit?limit=...&entityType=...&entityId=...` | admin | WHERE適用後にLIMITする監査ログ |
| `POST` | `/api/admin/reset` | admin＋CSRF＋3つのdemo gate | 架空勤怠データを初期状態へ戻す |

静的PWA endpointは `/manifest.webmanifest`、`/sw.js`、`/offline.html`、`/icon-192.png`、`/icon-512.png`、`/apple-touch-icon.png`、`/icon.svg` です。

## 9. 認証・認可

- Sitesの共有範囲とアプリ内loginは別の境界です。一般公開にしても従業員・管理画面のAPIはD1 sessionとroleで保護します。
- passwordは個別salt付きPBKDF2-SHA-256でhash化し、平文をD1へ保存しません。公開デモaccountだけはSites本番workerdのhost上限に合わせて100,000反復とし、scheme、個別salt、保存形式は変更しません。
- session tokenとCSRF tokenはopaque random値を発行し、D1にはhashだけを保存します。session有効期間は12時間です。
- HTTPSでは `__Host-` prefix、`Secure`、`HttpOnly`、`SameSite` cookieを使用します。
- login失敗はaccount・IP fingerprintの両方で制限し、存在しないuserにもdummy hash検証を行います。
- roleと所有者はすべてserver側で検査し、URLやrequest bodyのuser IDを信用しません。

詳細とHTTP Basic不採用理由は [docs/adr/0001-sites-authentication.md](./docs/adr/0001-sites-authentication.md) を参照してください。

## 10. PWA

- manifest: `public/manifest.webmanifest`
- start URL: `/app`
- display: standalone
- icons: `public/icon-192.png`、`public/icon-512.png`（通常・maskable）、`public/apple-touch-icon.png`、`public/icon.svg`
- Service Worker: `public/sw.js`
- 非個人化app shell: `public/app-shell.html`
- navigation fallback: `public/app-shell.html`
- 補助的なprecacheページ: `public/offline.html`
- 更新検知: 新Service Worker待機時に利用者へ更新buttonを表示
- offline方針: 非個人化shellと静的assetだけをcacheし、認証済みHTML・RSC・APIはcacheしない。更新をqueueせず、成功していない打刻・保存を成功表示しない
- viewport: 390×844、430×932、768×1024、1440×900をPlaywright設定済み

Phase 2では実URLをinstallし、standalone起動、safe area、offline案内、online復帰、Service Worker更新を確認します。Sites runtimeやheaderによりinstall条件が変わる場合は制約として記録します。

## 11. 必須smoke

詳細手順はrunbookにあります。最低限、実URLで次を確認します。

1. 未認証で従業員・管理者APIを利用できない。
2. employee accountでloginし、管理者APIは403になる。
3. admin accountでloginし、管理画面と監査を表示できる。
4. 通常モードのGPS許可・拒否・timeoutはローカルの隔離D1と合成座標だけで確認する。実URLの公開デモでは端末GPSを要求せず、直接送った座標も破棄することを確認する。
5. 本人修正が保存され、元の打刻イベントを保持したまま監査ログが増える。
6. 申請作成・取消・承認・却下と、打刻済み日の承認競合を確認する。
7. reloadと別sessionでD1永続化を確認する。
8. admin reset後に架空初期状態へ戻り、監査される。
9. manifest、Service Worker、standalone、offline案内を確認する。
10. 実在の個人情報、実credential、実GPSが含まれないことを確認する。

## 12. 既知制約・Phase 2確認事項

1. **Sites public beta**: plan、region、workspace設定、利用上限に依存します。
2. **すべてのdeployがproduction**: reviewにはdeployせず「version保存」を使います。公式上、deploy URLはすべてproductionです。
3. **data residencyなし**: ローンチ時点でSite、D1/R2、生成物、ログを含むdata/inference residencyはありません。架空データだけを使用します。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)
4. **Vinext beta advisory**: `vinext@1.0.0-beta.5` がadvisory対象の `image-size@2.0.2` を固定しています。npmの提示する解消は互換性を崩すdowngradeで、Phase 1では適用していません。公開前に修正版の有無と入力面を再評価します。
5. **実D1経路**: migration・seedはローカルで成功済みですが、SitesがprovisionしたD1への適用経路、実行結果、再実行性、backup/rollbackをPhase 2で確認します。
6. **D1 batch**: HTTP resetのstatement数、申請判断・勤怠修正の条件付きbatch、実環境latency、failure時挙動を実D1で確認します。
7. **PBKDF2 host上限**: Sites本番workerdはPBKDF2を100,000反復までに制限し、600,000反復は `NotSupportedError` になります。公開済みの架空デモaccountだけ100,000反復へ互換調整します。600,000反復を必要とする実credential運用はPhase 1へ戻す課題です。[workerd limit enforcer](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h#L27)
8. **session運用**: 自動的な期限切れsession清掃jobはありません。PoC後に運用する場合はcleanup方針が必要です。
9. **PWA実URL**: Sitesのresponse header・scope下でinstallabilityとoffline fallbackを確認します。
10. **実在データ禁止**: 勤怠、メール、位置情報、ログを含め、架空値以外は投入しません。

## 13. Phase 2への次の一手

1. [SITES_DEPLOYMENT_RUNBOOK.md](./SITES_DEPLOYMENT_RUNBOOK.md) を読む。
2. 固定コミットとclean worktreeを確認する。
3. 全ローカル検査を再現する。
4. Sitesでまずowner/admin限定のprojectとsaved versionを準備する。
5. `DB` provision、migration、架空seed、environment nameだけを確認する。
6. saved versionをreviewし、明示承認後だけproductionへdeployする。
7. 実URL smoke後に、許可された最小の共有範囲を設定する。
8. `SITES_DEPLOYMENT_RESULT.md` へURL、commit、version、resource名、結果、制約、rollbackを記録する。
