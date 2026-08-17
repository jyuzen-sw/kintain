# ChatGPT Sites運用ガイド

本書は、このリポジトリをChatGPT Sitesで保存・公開・停止するときの恒久的な確認事項をまとめます。特定のデプロイ日時、commit SHA、version ID、公開URL、実行結果は扱いません。それらはGitHub Issue、Pull Request、またはアクセス制限された運用記録へ残してください。

Sites自体の提供範囲と操作方法は[OpenAI Sites公式ドキュメント](https://learn.chatgpt.com/docs/sites)を正本とします。

## 構成

- [`.openai/hosting.json`](../../.openai/hosting.json)はSites projectとの関連付けとstorage binding名だけを保持します。secretやhosted environment valueを追加しません。
- D1の論理bindingは`DB`です。schemaは[`db/schema.ts`](../../db/schema.ts)、migrationは[`drizzle/`](../../drizzle/)を正本とします。
- R2は使用しません。永続ファイルが必要になった場合は、データ分類と削除・復旧方針を決めた別変更として追加します。
- runtime environment valueはSites settingsで管理します。secret値をprompt、添付、source、文書、画面capture、logへ転記しません。

## 公開デモ設定

公開デモは次の3設定がすべて`true`の場合だけ有効です。

- `DEMO_MODE`
- `ALLOW_PUBLIC_DEMO`
- `SHOW_DEMO_CREDENTIALS`

1つでも無効なら、公開デモ用の初期化、credential表示、HTTP reset、公開デモ向け位置情報破棄を有効化しません。このgateは、D1に既に存在するcredentialの失効やrotationを行うものではありません。

公開デモを有効にする場合は、架空accountと合成データだけを使用します。通常credentialを扱う環境は、このSites構成の対象外です。

## Versionを保存する前の確認

1. 対象commitとbranchを固定し、worktreeがcleanであることを確認する。
2. 次の検証を実行し、失敗やskipを残さない。

   ```bash
   npm ci
   npm run lint
   npm run typecheck
   npm run test:unit
   npm run test:integration
   npm run test:e2e
   npm run build
   ```

3. source差分、生成されたWorker artifact、hosting manifest、未適用migrationを確認する。
4. migrationがファイル名順の前進変更であり、既存D1データを意図せず破壊しないことを確認する。
5. secret、実在人物の情報、実端末の位置情報、不要な生成物がsourceとartifactへ含まれていないことを確認する。

検査結果の件数や実行日時は、この文書へ固定せず対象IssueまたはPull Requestへ記録します。

## 保存・レビュー・デプロイ

1. 固定したcommitからversionを保存し、まだdeployしない。
2. versionが参照するcommit、build結果、D1 binding、migration、runtime environment valueの設定有無を確認する。
3. previewでログイン、従業員画面、管理者画面、responsive表示を確認する。
4. 承認済みversionを、まずownerとworkspace adminに限定してdeployする。
5. 次節のsmokeが完了してから、責任者が承認した最小の共有範囲へ変更する。

すべてのdeployment URLはproductionとして扱います。試行錯誤には未deployのsaved versionを使用します。

## デプロイ後smoke

### 認証・認可

- 未認証の保護APIが401、従業員による管理APIが403になる。
- 架空の従業員と管理者がログインでき、それぞれ許可された画面だけへ到達できる。
- logout後のsessionを再利用できない。
- CSRF headerなし、または別originからの更新要求が拒否される。
- 公開デモでは端末のgeolocation APIを呼ばず、直接送信した座標も保存しない。

### 勤怠・管理

- 出勤と退勤、本人修正、申請作成と取消がreload後も保持される。
- 管理者が勤務予定と実績を変更し、申請を承認・却下できる。
- 同じclient request IDの再送でデータが重複せず、異なるpayloadへの流用が競合になる。
- 変更前後、actor、理由が監査ログへ残る。
- 別browser sessionから同じD1上の結果を確認できる。

### PWAとデータ安全性

- manifest、Service Worker、iconが取得でき、standalone用レイアウトが崩れない。
- offline中の更新を成功表示またはqueueせず、復旧後の明示的な再試行で保存できる。
- 認証済みHTML、API response、個人別データがCache Storageへ保存されない。
- responseとlogにpassword hash、session token、hosted environment valueが出ない。

破壊的なsmokeを行った場合は、架空デモに限り管理者resetで既定シナリオへ戻します。任意データの復旧手段としてresetを使用しません。

## MigrationとD1

- migrationは追加による前進変更を基本とし、適用済みファイルを書き換えません。
- deploy前にbackupまたはexport手段、復旧責任者、schema互換性を確認します。
- application versionを戻してもD1のschemaとdataは自動では戻りません。
- migrationの適用状態を直接取得できない場合は、deploy結果と実URLのAPIで必要なschemaと永続化を確認し、未確認の値を推測して記録しません。
- D1削除、table drop、Site削除は通常のrollbackに使用しません。

## 緊急停止とロールバック

1. Siteの共有範囲をownerとworkspace adminへ制限し、以前の訪問者が到達できないことを確認する。
2. 直前に正常だった、現在のD1 schemaと互換性のあるsaved versionを特定する。
3. runtime environment valueはversionと別に確認し、必要なら承認済み設定へ戻す。
4. 正常versionをdeployし、認証、永続化、主要勤怠操作、PWAのsmokeを再実行する。
5. credentialや個人情報の露出が疑われる場合は、sessionと対象credentialを失効し、log・D1・artifact・Git履歴への影響を調査する。

Siteの完全削除は復元できないため、アクセス制限と互換versionへの切り戻しを先に使用します。
