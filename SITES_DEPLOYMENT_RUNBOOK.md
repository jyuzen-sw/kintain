# ChatGPT Sites Phase 2 デプロイrunbook

## 目的と境界

このrunbookは、Phase 1で固定した勤怠管理PoCをPhase 2担当者がChatGPT Sitesへ実デプロイするための手順です。**この文書を作成したPhase 1では、Site、実D1、実環境値、saved version、production deployment、公開URLを一切作成していません。**

OpenAI公式では、Sitesの公開処理は「review可能なversionを保存する」「選んだversionをproductionへdeployする」の二段階です。また、すべてのSites deployment URLはproduction deploymentです。確認だけのためにdeployせず、先にversionを保存します。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 0. 開始条件と停止条件

### 必ず揃えるもの

- [SITES_HANDOFF.md](./SITES_HANDOFF.md) に記載された固定commit
- cleanなworktree
- `README.md`、`DESIGN.md`、本runbook、認証ADR
- ChatGPT Sitesを利用できるplan、region、workspace権限
- SiteとD1をprovisionし、environment valuesと共有範囲を管理できる権限
- 架空データだけを扱うことへの担当者承認

### deployせず停止する条件

- commitが引き継ぎ記録と一致しない、またはworktreeがdirty
- `npm ci`、lint、typecheck、unit、integration、E2E、buildのいずれかが失敗
- SitesがVinext/Worker artifactまたはD1 bindingを受理しない
- `0001_initial.sql`、`0002_request_idempotency.sql`、`0003_demo_seed.sql` の同梱順、deploy結果、または実URLでのschema利用を確認できない
- `0003`、公開デモgate下の空D1限定bootstrap、または厳密に識別した同梱seedの一度限りの整合のいずれでも、架空seedを安全に投入・確認できない
- 実在人物のメール、勤怠、位置情報、credentialが混入
- environment valueをprompt、添付、source、logへ転記する必要が生じる
- 一般公開の責任者承認がない

互換性修正が必要なら、D1 binding、build、runtime、header、route設定に閉じた最小修正だけを独立commitにします。機能、認証方式、権限、勤怠規則、schema、デザインの変更はdeploy作業へ混ぜず、実装Phaseへ戻します。テスト削除・skipは禁止です。

## 1. 固定成果物を再現する

```bash
git status --short
git branch --show-current
git rev-parse HEAD
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

確認事項:

- `git status --short` が空である。
- commitがhandoffと一致する。
- lockfileを変更せずinstallできる。
- `dist` にWorker互換ESM artifactが生成される。
- ローカルD1でmigration、seed、resetを再現できる。
- E2Eを390×844、430×932、768×1024、1440×900で確認する。
- source、Git履歴、build logに実Secretや実個人情報がない。

結果を作業記録へ転記します。失敗を「Sitesでは通るはず」として先送りしません。

## 2. Sites projectを準備する

Sitesの作成・保存・deploy・管理はChatGPT webまたはdesktop appから行います。単独のCodex CLI管理画面はありません。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

1. ChatGPTでSitesを開く。
2. 固定したローカルprojectを既存projectとして選ぶ。
3. audience、用途、架空データ限定、アプリ内email/password認証を明示する。
4. 初期accessはownerとworkspace adminに限定する。
5. source commit、build command、Worker entryを確認する。
6. この時点ではdeployしない。

Sitesへの依頼内容には、次の不変条件を含めます。

- Vinext starter互換のWorker ESMを使う。
- D1の論理bindingは `DB` から変えない。
- R2は使わない。
- schemaは `db/schema.ts`、migrationは `drizzle/0001_initial.sql` → `drizzle/0002_request_idempotency.sql` → `drizzle/0003_demo_seed.sql` を正とする。`0003` は空D1専用の一度限りの架空データmigrationであり、schemaは変更しない。
- 架空データ以外を投入しない。
- Sites accessとアプリ内login/role認可を別々に維持する。
- 既存のテストやsecurity checkを外さない。

OpenAI公式showcaseもVinext、Worker互換ESM、D1 `DB`、R2なし、Drizzle schema/migration、事前lint・typecheck・build・ローカルD1検証を要求しています。[OpenAI Sites showcase: Sparkboard](https://learn.chatgpt.com/showcase/idea-intake)

## 3. D1をprovisionしてbindingする

1. Sites projectへdurable structured dataが必要であることを指定する。
2. SitesがprovisionするD1を論理名 `DB` でbindingする。
3. `.openai/hosting.json` のD1が `DB`、R2が未使用のままであることを確認する。
4. provision後にSites project linkageが設定されたことを確認する。
5. 実resourceの識別子・名称はPhase 2結果へ記録し、prompt、README、公開画面、logへSecretと一緒に貼らない。

公式ドキュメントでは、ローカルstarterは `project_id` なしで開始でき、Sitesがhosted projectをprovisionした後にproject linkageを追加します。また、永続的なstructured dataにはD1を使います。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 4. migration `0001` → `0002` → `0003` を適用する

1. 対象が新規の空D1であることを確認する。
2. `drizzle/0001_initial.sql`、`drizzle/0002_request_idempotency.sql`、`drizzle/0003_demo_seed.sql` を開き、9テーブル、前進処理、index、架空seedだけの `INSERT` を再確認する。
3. package内の3ファイルとdeploy成功を確認する。Sites connectorが物理D1名、migration履歴、SQL照会を公開しない場合は、その観測制約を結果へ明記し、実URLのAPIでschemaとデータを確認する。
4. 確認済みの経路で `0001_initial.sql`、`0002_request_idempotency.sql`、`0003_demo_seed.sql` をこの順で各一度だけ同梱・deployする。
5. 3つのmigration名、開始・終了時刻、deploy結果を記録する。物理resource名とmigration履歴がconnectorから取得不能なら、取得不能と代替検証結果を記録し、推測値を書かない。
6. 次のテーブルが存在することを確認する。

```text
users
work_sites
work_schedules
attendance_records
punch_events
attendance_requests
audit_logs
sessions
login_rate_limits
```

7. `users(normalized_email)`、予定・実績の日次一意制約、打刻冪等key、申請の部分一意制約、外部キーが存在することを確認する。
8. `attendance_requests.creation_request_id` が `NOT NULL UNIQUE`、`audit_logs.mutation_id` がnullable uniqueであることを確認する。

`0002`は既存の`0001`適用済みD1を前進できるよう申請テーブルを再構築します。`0003`はPhase 2で固定した架空データを空D1へ一度だけ投入する前進データmigrationです。fresh D1では3本すべてを順に同梱し、既存データ入りD1へ`0003`を適用しません。connectorが履歴を公開しないこと自体は観測制約として記録し、deploy失敗、schema差分、部分適用の兆候、または既存データがある場合はdeployを止めます。saved versionのrollbackだけではD1 schema/dataは戻らないため、先にbackup/export手段と復旧責任者を確認します。

## 5. 架空seedを実D1へ投入する

`scripts/local-db.ts` の `seed` と `reset` は誤操作防止のため `--local` 固定です。Phase 2では、レビュー済みの生成結果を `drizzle/0003_demo_seed.sql` として固定し、Sites標準packageが `dist/.openai/drizzle/` へ同梱するmigration-aware経路で実D1へ一度だけ適用します。ローカルscriptを実D1へ向けません。

1. 新規Siteとして空D1を意図していることを確認する。connectorから実データを照会できない場合は、その制約を記録して既存Siteへ流用しない。
2. ローカルpassword上書き用の環境変数が設定されていないことを確認する。
3. `0003_demo_seed.sql` が7つの `INSERT` だけで構成され、実在ドメイン、実名、実勤怠、実GPSを含まないことを確認する。
4. 6架空user、2架空site、当日・前日の予定、勤務中・退勤済み・出勤前・病欠承認済み、合成GPS状態、pending・approved・rejectedの申請例、監査例を確認する。
5. 必要に応じて `npm run --silent db:seed:render` を一時出力し、構造と架空シナリオが一致することを確認する。saltと生成日時が毎回変わるため、byte一致は要求しない。
6. package内に `0001_initial.sql`、`0002_request_idempotency.sql`、`0003_demo_seed.sql` がこの番号順で存在することを確認する。
7. Sitesのmigration-aware経路で3本を同梱・deployする。connectorから履歴を照会できない場合は、deploy結果と実URLのschema利用を記録する。
8. user、site、schedule、record、punch、request、auditの件数と参照整合性をアプリ挙動または承認済みD1照会で確認する。
9. 架空accountで通常のlogin APIを通過できることを確認する。schemaは利用できても全架空accountが401となる場合は、workerdのPBKDF2 host上限も確認し、3つの公開デモgate下で動く `ensurePublicDemoBootstrap()` を使う互換性versionへ切り替える。8つのアプリ表（`login_rate_limits`を除く）が合計0件なら既定user・siteと当日シナリオを1つのD1 batchで作成する。`0003` のデータが存在する場合は、全件数と既知IDが固定seedと完全一致するときだけ、100,000反復の公開資格情報と実行日シナリオへ一度だけ整合する。旧600,000反復hashで整合済みの場合も、全6件のdirectory値・旧hash・初期化監査・sessionなしが完全一致するときだけ、勤怠をresetせずhashだけをatomic更新する。各処理は一意markerを使い、並行要求の競合batchは全体rollbackして、完成済み既定状態だけをno-opとして認める。任意の既存userは変更せず、userなしの部分状態は503で停止する。
10. 初回login後に管理者の `POST /api/admin/reset` を実行し、当日シナリオへ戻ることと再実行性を確認する。

`0003` は既存データ入りD1へ再適用しません。部分適用の兆候がある場合は盲目的に再実行せず、事前承認した空D1の再作成またはbackupからのrestoreへ戻ります。履歴がconnectorから取得不能なら、その事実と実URLの代替検証を記録します。`db:seed:local` は非空ローカルDBを拒否し、`db:reset:local` は既存データを明示的に消してから全migrationと動的seedを再現します。

管理者の `POST /api/admin/reset` 自体は空D1の初回bootstrapではありません。初回bootstrapは、公開デモgate下のlogin POSTが8つのアプリ表の合計0件を確認した場合だけ、既定user・siteの作成と同じreset statement群を原子的に実行し、監査理由に自動初期化と記録します。Sites同梱seedの整合も全件数と既知IDが固定seedに厳密一致した場合だけ同じstatement群を実行し、別の監査sourceと一意markerを残します。部分状態と任意の既存状態は変更しません。通常のreset APIは既存user・siteを前提に、勤怠系の架空データを戻す日常デモ用です。

## 6. hosted environment valuesを設定する

SitesのSite settingsから、handoffに列挙したruntime environment名を登録します。**Secretや非公開の環境固有値は、このrunbook、prompt、添付、source、画面capture、log、deployment resultへ書きません。** 3つのgateは非Secretのbooleanですが、hosted設定はSite settingsで行い、deployment resultには設定有無だけを残します。

対象名:

- `DEMO_MODE`
- `ALLOW_PUBLIC_DEMO`
- `SHOW_DEMO_CREDENTIALS`

`LOCAL_DEMO_EMPLOYEE_PASSWORD` と `LOCAL_DEMO_ADMIN_PASSWORD` はローカル専用なので登録しません。
現在の実装にSitesへ登録するSecretはありません。

確認事項:

- demo account表示には3つのruntime gateがすべて必要である。
- HTTP resetは3つのruntime gateとadmin session・CSRFをすべて要求する。
- 3つのgateが有効な公開デモでは、端末のgeolocation APIを呼ばず、直接APIへ送られた座標も破棄する。
- 3つのgateのどれかを無効にした通常モードでは、credential表示とHTTP resetの両方が拒否される。ただしlogin APIと公開済みseed credentialは無効にならない。
- environment変更後は承認済みsaved versionの再deployが必要である。

3つのgateは認証credentialの失効機構ではありません。公開済みseed credentialを使うSiteは、3つのgateをすべて有効にする公開デモとして明示承認するまでowner/admin限定を維持します。非公開credentialが必要なら、安全な投入とrotationを別の実装Phaseへ戻します。

Sites公式はhosted environment valuesをSite settingsで管理し、`.openai/hosting.json` に保存せず、promptや添付へSecret値を書かないよう案内しています。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 7. review用versionを保存する

1. fixed commitからbuildするようSitesへ依頼する。
2. deployではなく **version保存** を選ぶ。
3. versionが関連付けたGit commitを確認する。
4. build logにWorker entry、hosting metadata、D1 migrationが含まれることを確認する。
5. preview/reviewでlogin画面、従業員画面、管理者画面、responsive UIを確認する。
6. source差分とmigrationをreviewする。
7. Secret、実resource ID、実個人情報がUIやlogへ漏れていないことを確認する。

Sites公式ではlocal sourceのsaved versionはbuildに使ったGit commitと関連付けられます。保存したversionをdeployするまでproduction URLへ公開しません。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 8. 限定accessでproductionへdeployする

明示的な承認を得た後だけ、review済みsaved versionをdeployします。

1. deploy対象versionとcommitを読み上げて二者確認する。
2. accessをowner/workspace adminのままにする。
3. review済みversionをdeployする。
4. production URLとdeployment versionを非公開の作業記録へ保存する。
5. buildとruntime healthを確認する。
6. 次節のsmokeを完了するまでaccessを拡大しない。

deploy URLはpreviewではなくproductionです。試行deployを繰り返さず、修正時は新しいversionを保存・reviewしてからdeployします。

## 9. 実URL smoke

### 9.1 access、認証、認可

- 未認証でemployee/admin APIを呼び、401になる。
- login失敗時にuserの存在有無を区別しない。
- employee accountでloginし、employee画面を表示できる。
- employee sessionでadmin APIを呼び、403になる。
- admin accountでloginし、全admin画面を表示できる。
- logout後に同じsessionを再利用できない。
- mutationをCSRF headerなし・別originから送り、拒否される。
- cookieがHTTPS向け属性を持ち、session tokenがclient JavaScriptから読めない。

### 9.2 従業員workflow

- 出勤前accountで出勤し、reload後も出勤済みになる。
- 同一のclient request IDを再送し、二重打刻が作られない。
- 通常モードのGPS許可、拒否、取得不能、timeoutは、ローカルの隔離D1とbrowser mockの明示的な合成座標だけで事前確認する。実端末の実座標を実D1へ送らない。
- 実URLでは3つのdemo gateを有効にし、端末GPSを要求せず、直接送信した座標もD1に残らないことを確認する。
- 出勤済みaccountで退勤し、予定休憩または既定休憩が反映される。
- 自分の当日・過去実績を修正し、version競合を確認する。
- 月次実績がJST日付・日本語曜日で表示される。
- 申請を作成・取消し、他employeeの申請が見えない。

### 9.3 管理者workflow

- 当日、現場別、個人月次、申請、監査の全画面を表示する。
- 実績を修正し、変更前後・actor・理由が監査される。
- pending申請を承認し、非勤務区分と監査が反映される。
- 別のpending申請を却下し、理由と監査が反映される。
- 打刻済み日の非勤務申請承認が競合として拒否される。
- admin resetを実行し、初期架空シナリオへ戻る。
- reset後もadmin sessionとuser/siteが維持され、reset監査が残る。

### 9.4 永続化と実D1

- 変更後にreloadして値が残る。
- 別browser sessionから同じ値を確認できる。
- application再deploy後もD1 dataが意図せず初期化されない。
- D1 queryで重複打刻、重複有効申請、孤立外部キー、GPSを複製した監査JSONがない。
- 同一payloadの打刻・修正・申請操作を同じUUIDで再送すると同じ結果、異なるpayloadへの流用は409になる。
- HTTP resetのD1 `batch()` が実環境で完了し、実行時間とエラーを記録する。

### 9.5 PWA

- `/manifest.webmanifest` が成功し、start URLとstandalone設定が正しい。
- 192×192 PNG、512×512 PNG、maskable 512×512 PNG、Apple touch icon、SVGが成功する。
- `/sw.js` が同一scopeで登録される。
- mobile端末または対応browserでinstallできる。
- standaloneでsafe areaとnavigationが崩れない。
- offlineで画面遷移すると明示的なoffline案内が出る。
- offline中に打刻・保存を成功表示せず、API mutationをqueueしない。
- online復帰後、利用者の再試行で正常に保存できる。
- 新versionのService Worker更新通知とreloadを確認する。

### 9.6 データ安全性

- 公開画面、API、D1、監査、logに架空データ以外がない。
- 位置情報がseedまたは明示的browser mockの合成座標だけであり、訪問者端末の実GPSがない。
- environment value、session token、password hashがresponseやlogへ出ない。
- Sites accessとアプリ内loginが別々に機能する。

## 10. 共有範囲を決定する

smoke完了後、責任者承認のある最小範囲へ変更します。一般公開が選択可能かはplan・workspace policyに依存します。公開済みseed credentialを使う現行PoCは、3つのdemo gateを有効にする公開デモとして明示承認された場合だけpublicへ変更できます。それ以外はowner/admin限定を維持します。Sites accessをpublicにしても、従業員個人実績とadmin APIはアプリ内login/role認可を外しません。

公式ドキュメントでは、Site audienceとSite内のsign-in機能は別のcontrolです。また新規Siteはowner/admin限定から開始し、review後に必要最小の共有範囲を選ぶよう案内しています。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

共有変更後は、signed-out browserと想定visitor accountの両方で到達性を再確認します。

## 11. rollbackと緊急停止

### アプリの不具合

1. まずSite accessをowner/admin限定へ戻す。
2. 直前に正常だったsaved versionとcommitを特定する。
3. D1 schema互換性を確認する。
4. 承認後、正常versionを再deployする。
5. smokeの認証、永続化、PWAを再実行する。

### credential・個人情報の露出疑い

1. 即座にaccessを制限する。
2. 対象environment valueとsessionを失効・交換する。
3. log、D1、saved artifact、Git履歴への露出範囲を確認する。
4. 原因と対応をsecurity incidentとして記録する。
5. 再公開は責任者承認後に行う。

### D1 migration・data不具合

- saved versionのrollbackだけでD1 schema/dataは戻りません。
- 事前に確認したbackup/exportからの復旧を優先します。
- destructiveなtable drop、D1削除、Site削除は明示承認なしに行いません。
- SitesのSite削除は復元不能と公式に明記されているため、access制限とversion rollbackを先に使います。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

## 12. Phase 2結果を残す

非公開の運用記録へ次を保存します。リポジトリ自体がprivateであることを確認できた場合だけ、直下の `SITES_DEPLOYMENT_RESULT.md` を使えます。公開され得るリポジトリにはproduction URLやD1 resource識別子を残さず、非公開記録への参照だけを記載します。

- deploy日時、担当者、承認者
- source branch、commit、dirty/clean確認
- Sites project名、production URL、deployment version
- D1 resource名とbinding名
- migration名、適用結果、seed件数
- environment **名称だけ** と設定有無
- 全local再検証結果
- 実URL smoke各項目の結果と証跡
- PWA install/offline結果
- access範囲
- 互換修正commitと理由
- 既知制約、未解決事項
- rollback対象versionと手順

## 13. Sites固有の最終確認

- Sitesはpublic betaで、availabilityとlimitがplan・region・workspace設定に依存する。
- every deploymentはproductionである。
- environment valuesはSite settingsに置き、manifestへ書かない。
- Sitesはローンチ時点でdata residency / inference residencyを提供しない。Site code、D1/R2、artifact、logも含む。
- Protected Health Information、決済カード情報、実在従業員データを扱わない。
- 実D1のbatch、公開デモPBKDF2 100,000反復のlogin latency、PWA挙動を実測する。600,000反復を必要とする実credential運用はPhase 1へ戻す。
- Vinext betaと `image-size` advisoryを再評価し、解消できなければPoC限定を維持する。
