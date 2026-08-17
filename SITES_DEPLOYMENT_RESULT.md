# ChatGPT Sites デプロイ結果

> 状態: **Phase 2完了・一般公開中**
> 所有者限定スモーク、一般公開デプロイ、公開URLでの認証・永続化・PWA最終検証まで完了した。

## 1. 対象と日時

| 項目 | 値 |
| --- | --- |
| 実施期間 | 2026-08-10〜2026-08-11（Asia/Tokyo / JST） |
| 所有者限定デプロイ完了 | 2026-08-10 14:58:17 JST |
| 一般公開完了 | 2026-08-10 15:23:53 JST |
| 公開後最終検証完了 | 2026-08-11 18:08:01 JST |
| リポジトリ | `https://github.com/jyuzen-sw/kintain` |
| Phase 2ブランチ | `codex/phase2-sites-deploy` |
| Phase 1引き渡しコミット | `2038b15606f907e1ecf2d27d4b2d64d0fde24bd6` |
| Phase 1検証済み実装コミット | `d9e68606f9bf3a762fbcea4d72d77e3ea4fbef5a` |
| デプロイ対象コミット | `1c098075867dd249586a5eac432d2338ace6f013` |

`SITES_HANDOFF.md` が指定する `2038b156...` と、その唯一の親 `d9e68606...` を確認して開始した。リポジトリ内には正本として指定された `勤怠管理PoC_CodingAgent仕様書.md` が存在しなかったため、欠落として記録し、外部引き渡し資料 `勤怠管理PoC_二段階Agent実行仕様書.md`、`SITES_HANDOFF.md`、`SITES_DEPLOYMENT_RUNBOOK.md` を用いて確認した。

## 2. Siteとデプロイ

| 項目 | 値 |
| --- | --- |
| Site名 | 勤怠管理PoC |
| Site slug | `kintain-poc-20260810` |
| URL | `https://kintain-poc-20260810.jyuzen-sw-0753.chatgpt.site` |
| デプロイバージョン | 4（live） |
| Version ID | `appgprj_6a794d5313c08191a3d3404aa005136b~appgver_caf3d388a384819187a6319be48fa544` |
| 所有者限定Deployment ID | `appgdep_6a79686f1f2481919275e29fe6275ac2` |
| 公開Deployment ID | `appgdep_6a796e7012b0819195d67f4fd2a51fee` |
| 環境変数revision | 1 |
| 現在の公開範囲 | `public`（URLを知る全員）、access policy revision 2 |

Sites専用ソースの `main` へ上記デプロイ対象コミットをpushし、同じコミットから生成したアーカイブを保存した。アーカイブは `dist/server/index.js`、`.openai/hosting.json`、3マイグレーションを含み、`.git`、`node_modules`、`.env`、`.dev.vars` を含まないことを検査した。

## 3. Phase 2追加コミット

| SHA | 理由 |
| --- | --- |
| `6642714c6122c00f0ba667106bb10a6b9fbedd5e` | Sites実D1の初期化経路、同梱デモseed、Windows実行互換を追加 |
| `0ce05ea0f5c111957693ef61758cd9852193bc05` | 空D1だけを安全に初期化する3ゲートと失敗閉鎖を追加 |
| `8fd66b549892e81ea4546ad28f0ca8c5121caac9` | 初回ログインが並行した場合のD1初期化競合を原子的に防止 |
| `c86ade8ae01f16a04f2c1e80eae1751d44e22e94` | Sites同梱seedを厳格に識別し、実行日シナリオへ一度だけ整合 |
| `1c098075867dd249586a5eac432d2338ace6f013` | Cloudflare workerdのPBKDF2上限へ公開デモ認証だけを最小適合 |

機能、画面構成、権限モデル、勤怠ロジック、申請フロー、データモデルは変更していない。最後の互換修正でもPBKDF2-SHA256と保存形式は維持し、公開済みの架空デモアカウントだけを100,000 iterationsへ調整した。一般用途の `hashPassword()` はPhase 1の600,000 iterationsを維持している。

## 4. D1、マイグレーション、シード、環境設定

| 項目 | 値・結果 |
| --- | --- |
| 論理D1バインディング | `DB` |
| 物理D1リソース名 | Sites管理リソース。現在のSitesコネクターでは物理名を取得できない |
| R2 | 未使用（`null`） |
| Secrets | このPoCで追加必須Secretなし。Secret値の記録なし |
| デモ設定 | `DEMO_MODE=true`、`ALLOW_PUBLIC_DEMO=true`、`SHOW_DEMO_CREDENTIALS=true` |

次のマイグレーションを順番どおりSitesアーカイブへ同梱し、version 4としてデプロイした。

1. `drizzle/0001_initial.sql`
2. `drizzle/0002_request_idempotency.sql`
3. `drizzle/0003_demo_seed.sql`

上記3ファイルを同梱したversion 4のdeploymentは成功し、実URLの業務APIが全schemaを利用できることを確認した。Sitesコネクターには物理D1の一覧、SQL実行、migration ledger参照機能がないため、物理リソース名とledgerは直接取得できない。代わりに、初回ログイン前に走る厳格なbootstrap/reconciliation、通常ログインAPIの成功、全業務操作、別セッション永続化、管理者リセットを実URLで検証した。初回ログインは200、続くログインも200で、Worker例外・5xxは確認されなかった。

公開デモへの切替条件は `DEMO_MODE`、`ALLOW_PUBLIC_DEMO`、`SHOW_DEMO_CREDENTIALS` の3つがすべて`true`であること。1つでも`false`なら公開デモbootstrap/reset経路は動作しない失敗閉鎖をunit/integration testで確認した。

架空seedはユーザー6件（管理者1、従業員5）、現場2件、予定6件、実績6件、打刻5件、申請3件、監査3件を基礎とし、管理者リセット後はリセット監査を加えた既定シナリオへ戻る。メールはすべて `.example.test`、表示名・位置値は合成データである。公開デモモードの新規打刻は、端末座標を保存せず `unavailable` として記録する。

## 5. ローカル再検証

| 検証 | 結果 |
| --- | --- |
| `npm ci` | 成功 |
| lint | 成功 |
| typecheck | 成功 |
| unit test | 12 files / 79 tests 合格 |
| D1 integration | 1 file / 23 tests 合格 |
| Playwright E2E | 14 tests 合格 |
| production build | 成功。`dist/server/index.js`生成を確認 |
| `git diff --check` | 成功 |

E2E後に生成されるvisual QA画像は固定コミットの内容へ戻し、Phase 2コミットへ混入させていない。テストの削除、skip、無効化は行っていない。

## 6. 実URLスモークテスト

所有者限定の実URLで、HTTP/API 45項目と実ブラウザー8項目が合格した。各破壊的テストの最後に管理者リセットを実行した。

### 公開・認証・認可

- 未認証で `/login` が200。
- 架空の従業員・管理者が通常の `/api/auth/login` で200。
- 既知メールの誤パスワードと未知メールが同じ `401 INVALID_CREDENTIALS`。
- 未認証の管理APIは401、従業員の管理APIは403。
- 従業員による他人の実績監査取得は403。
- 管理者だけが管理APIとデモリセットを実行でき、従業員のリセットは403。

### 勤怠・監査

- GPS拒否入力でも出勤・退勤が200。公開デモでは座標を保存しない。
- 同一 `clientRequestId` の再送は200かつrecord version不変で、重複打刻なし。
- 退勤時に予定休憩60分と実経過時間の安全な小さい値を自動設定。
- 当日・過去日の本人修正が200。
- 修正後も当日の出退勤イベントが残り、監査ログにbefore/afterと理由が保存された。

### 申請・管理

- `paid_leave`、`absence`、`sick_leave`、`other` の4区分がすべて201。
- 申請中の取消が200 `withdrawn`。
- 管理者承認が200 `approved`、却下が200 `rejected`。
- 打刻済み日の非勤務承認は409 `APPROVAL_PUNCH_CONFLICT`。
- 審査結果とbefore/after監査が管理画面および別セッションから確認できた。

### 永続化・デモ

- 新しいCookie jarで再ログインし、実績修正と承認結果を同じD1から確認。
- 管理者リセットが200となり、未打刻の既定シナリオへ復帰。
- リセット後も通常ログインが200で、初期化markerを保持することを統合テストでも確認。

### PWA

- Manifestは200、`display: standalone`、アイコン4件はすべて200。
- `/sw.js` は200 `text/javascript`。
- 現行HTMLが参照するJS/CSS 18件はすべて200。
- 実配信CSSにSafe Area指定があり、390×844で横スクロールなし。
- 一般公開URLをバイパスなしで開き、Service Workerが `/sw.js` から`activated`、scope `/` で登録されることを確認。
- Cache Storageは `kintain-static-v3`、`/app-shell.html` はcache済み、`/api/me/today` は非cache。API応答は200かつ `Cache-Control: no-store`。
- 実ブラウザーで `navigator.onLine=false` を確認してから「出勤する」を操作し、オフライン表示と再試行案内、成功表示なし、出勤前状態の維持を確認。
- 通信復旧後にリロードし、`/api/me/today` が `state=before_work`、`clockInAt=null` のままであることを確認。未保存打刻はD1へ記録されていない。
- 2026-08-11の最終検証前後に管理者リセットを実行し、本日基準の既定シナリオへ復帰した。
- 通常ブラウザータブの `display-mode: standalone` は`false`（想定どおり）。OSへインストールしたstandaloneウィンドウの実外観は既知の制約として別記する。

## 7. 既知の制約と影響

1. Sitesコネクターから物理D1名とmigration ledgerを取得できない。業務API・永続化・リセットで適用状態を検証した。
2. workerdホストはPBKDF2を1回100,000 iterationsまでに制限する。公開デモアカウントは100,000へ適合したが、Phase 1の一般用600,000 hashを実利用する認証はSites上で成立しない。実credential対応は「Phase 1へ戻す実装課題」である。
3. デプロイ切替時、旧HTML取得後に新Workerへ切り替わった約2秒間だけ旧hashのJS 4件が404になった。現行HTML・現行資産は全件200で、再読込により解消する一過性事象である。
4. `npm audit` はVinext経由の `image-size` にhigh 3件を報告する。強制修正はVinextの互換性を崩すためPhase 2では適用していない。
5. OSへPWAを実インストールしたウィンドウの外観確認は自動環境では実施できない。Manifestのstandalone指定、Safe Area CSS、モバイル幅、Service Workerとオフライン動作を代替確認する。
6. リポジトリに `勤怠管理PoC_CodingAgent仕様書.md` が欠落している。外部引き渡し資料で補完したが、正本のリポジトリ収載は別途必要である。
7. 一般公開後のWorkerログには、ブラウザーの補助要求 `/favicon.ico` の404と、未認証状態確認 `/api/auth/session` の401が記録される。いずれもWorker outcomeは`ok`で、例外・5xxはない。PWAで明示する4アイコンはすべて200のため、影響は従来型faviconの補助表示に限定される。

## 8. ロールバック

### 緊急停止

1. Site accessを `custom` に戻し、非所有者ユーザー・workspace group・tenant groupを空にする。
2. 必要に応じて以前の保存バージョンを再デプロイする。
3. 環境変数はversionに含まれないため、対象revisionへ別途戻す。

直前バージョン3は `c86ade8ae01f16a04f2c1e80eae1751d44e22e94` / `appgprj_6a794d5313c08191a3d3404aa005136b~appgver_3d5cf36746908191b1ec7536e01122fb`。ただしworkerdのPBKDF2上限に未対応で、正しいデモ資格情報でもログインが401になる。したがって、最初に公開範囲を所有者限定へ戻すことを安全上の優先手順とする。

D1データはSite versionのロールバック対象外である。デモデータだけを既定状態へ戻す場合は、現行の管理者認証後に `/api/admin/reset` を実行する。任意のSQL復元手順として扱ってはならない。

### 再デプロイ

1. 対象コミットをcleanなworktreeへcheckoutする。
2. `npm ci`、lint、typecheck、unit、integration、E2E、buildを再実行する。
3. `dist/server/index.js`、`.openai/hosting.json`、`drizzle/` を同一アーカイブへ梱包する。
4. 同じcommit SHAをSites専用ソースbranchへpushする。
5. 同じSHAとアーカイブで新しいSite versionを保存する。
6. D1 binding `DB` と環境変数revisionを確認する。
7. 非公開デプロイでスモーク後、公開範囲を明示承認してからpublicデプロイする。
8. 実URLで本書の認証・認可・永続化・PWA確認を再実行する。

## 9. 公開後の最終確認結果

- 一般公開完了日時、access policy revision 2、公開Deployment ID、status `succeeded` を確認した。
- Sites APIでSiteが `active` / `public` / live version 4であることを2026-08-11に再取得した。
- バイパスなしの公開訪問で未認証ログイン画面へ到達し、架空の従業員と管理者が通常ログインAPIを通ってログインできた。
- 管理者だけが管理画面とリセット操作へ到達できることを再確認し、最終リセットはHTTP 200。2026-08-11基準の予定を再生成し、△△さんのB現場・09:30開始予定を確認した。
- Service Workerのactive script `/sw.js`、scope `/`、`/app-shell.html` cache、API非cache、Manifest、4アイコンを公開ブラウザーで確認した。
- オフライン操作では再試行案内だけが表示され、再接続後も `before_work` / `clockInAt=null`。未保存打刻の成功表示・D1更新は発生しなかった。
- 公開ブラウザーのconsole warning/errorは0件。2026-08-11 17:47:06〜18:09:30 JSTのWorkerエラーフィルターは50件（未認証401が7件、補助favicon 404が43件）で、全件outcome `ok`、例外・5xxは0件だった。
- 最終状態はデモデータを既定シナリオへ戻し、ブラウザーもログアウト済みの `/login` とした。
