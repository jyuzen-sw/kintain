# ADR 0002: 公開デモだけPBKDF2コストをSites実行上限へ合わせる

- Status: Accepted
- Date: 2026-08-17
- Scope: ChatGPT Sitesで稼働する架空データ限定の公開デモ認証
- Amends: [ADR 0001](./0001-sites-authentication.md)

## Context

[ADR 0001](./0001-sites-authentication.md)は、通常accountのpasswordをPBKDF2-SHA-256の600,000反復でhash化し、未知accountの検証にも同等コストのdummy hashを使うと決めました。

ChatGPT Sitesのworkerd実行環境では、1回のPBKDF2に指定できる反復数が100,000までです。600,000反復のhashは保存できますが、検証時に実行上限を超えるため、正しいpasswordでもログインできません。

このリポジトリのSites用途は、公開済みの架空credentialと合成データだけを扱うPoCです。一方で、通常credentialの保護水準まで一律に下げる理由はありません。また、未知accountだけ計算量が異なると、応答時間からaccountの存在を推測できる可能性があります。

## Decision

- 通常環境の`hashPassword()`はPBKDF2-SHA-256の600,000反復を維持する。
- `DEMO_MODE`、`ALLOW_PUBLIC_DEMO`、`SHOW_DEMO_CREDENTIALS`がすべて`true`の公開デモ環境だけ、既知の架空accountを100,000反復で検証する。
- 公開デモの未知accountに使うdummy hashも100,000反復とし、既知accountと未知accountの計算量を揃える。
- 3つのgateのどれかが無効なら、dummy hashを含めて通常環境の600,000反復へ戻す。
- 同梱seedの600,000反復hashを変換する場合は、既知のuser ID、directory属性、旧hash、初期化状態がすべて一致する架空データだけを対象にする。任意の既存accountや部分状態は変更しない。
- 100,000反復の経路を通常credentialへ使用しない。Sitesで実credentialを扱う場合は、認証方式とcredential移行を別ADRで設計する。

## 採用しない案

### すべてのaccountを100,000反復へ下げる

Sites以外でも通常credentialのコストを下げることになり、実行上限へ適合させる範囲を超えます。公開済みの架空accountだけに例外を限定します。

### 600,000反復hashをそのまま失敗扱いにする

正しい公開デモcredentialでもログインできず、認証・認可を含むPoCを検証できません。また、例外を単なるpassword不一致へ変換すると原因を観測しにくくなります。

### client側でpasswordを事前変換する

再利用可能な変換値が実質的なcredentialとなり、TLS、rate limit、server側password検証の境界を複雑にするため採用しません。

### 外部identity providerへ置き換える

一般公開サービスでは有力ですが、このPoCの架空employee/admin、アプリ固有role、既存のemail/password workflowを置き換える別要件になります。

## Consequences

### Positive

- Sites上でも架空の従業員・管理者が同じアプリ内loginを利用できる。
- 通常環境の新規password hashは600,000反復を維持できる。
- 公開デモでは既知・未知accountのdummy検証コストが一致する。
- gateと厳密なseed照合により、100,000反復への変更対象を架空accountへ限定できる。

### Negative / trade-offs

- 公開デモaccountのPBKDF2コストは通常accountより低い。
- 1つのコードベースで2種類の反復数を扱うため、環境gateとdummy hashの回帰テストが必要になる。
- 600,000反復を必要とする実credentialは、現行のSites実行環境では利用できない。
- Sitesの実行上限が変わった場合は、この例外が引き続き必要か再評価する必要がある。
