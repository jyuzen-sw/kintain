# ADR 0001: Sites公開デモでもアプリ内loginとD1 sessionを使う

- Status: Accepted
- Date: 2026-08-10
- Scope: Phase 1の認証・認可設計、Phase 2のSites公開境界
- Amended by: [ADR 0002](./0002-sites-public-demo-password-cost.md)

## Context

このPoCは最終的にChatGPT Sitesで架空データの公開デモを行います。一方で、製品要件は次を要求します。

- 従業員はメールアドレスとパスワードでloginする。
- 従業員は自分の実績・申請だけを扱う。
- 管理者だけが全員の勤怠、申請審査、監査、demo resetを扱う。
- 一般公開デモでも認証を省略しない。
- 公開されるdemo credentialと、実credentialを完全に分離する。
- Sitesの共有範囲を変更してもアプリのrole境界を維持する。

SitesにはSite audienceのaccess controlと、Sign in with ChatGPTによるidentity取得があります。ただし公式ドキュメントは、Siteのaudience設定とSite内のsign-in機能を別のcontrolとして説明し、authorizationをserver側に置くよう求めています。[OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites)

本アプリ固有の `employee` / `admin`、password、session、所有者判定、監査をSites accessだけへ委ねることはできません。

## Decision

### 1. アプリ内email/password login

`users.normalized_email` と `users.password_hash` をD1へ保存し、`POST /api/auth/login` で通常のアプリloginを行います。公開demoのaccount入力補助も同じAPIを通し、account選択だけではsessionを発行しません。

passwordは次の形式です。

```text
pbkdf2-sha256$<iterations>$<salt-base64url>$<digest-base64url>
```

- PBKDF2-SHA-256
- 個別のrandom salt
- 32 byteのderived key
- Phase 1実装の反復回数は600,000
- 比較は入力長に依存しないbyte比較
- 存在しないuserにもdummy hash検証を行い、timing差とuser列挙を抑える
- 認証失敗messageはemailとpasswordのどちらが誤りかを区別しない

### 2. opaque sessionをD1へ保存

login成功時にrandomなsession tokenとCSRF tokenを発行します。browserへはtokenをcookieで返し、D1の `sessions` にはhashだけを保存します。

session rowは次を持ちます。

- session ID
- user ID
- session token hash
- CSRF token hash
- expiry
- created/last-seen timestamp

session有効期間は12時間です。logoutではtoken hashに対応するrowを削除し、cookieを失効します。userの無効化やrole判定はsession取得時にD1のuserと結合してserver側で評価します。

HTTPSではsession cookieに `__Host-` prefix、`Secure`、`HttpOnly`、`SameSite=Lax` を使用します。CSRF cookieはJavaScriptがheaderへ反映できるようHttpOnlyにはせず、`SameSite=Strict` とし、D1にはhashだけを保存します。ローカルHTTPでは開発専用cookie名へ切り替えます。

### 3. 更新系の防御

loginを含むmutationはrequest URLと `Origin` が同一であること、`Sec-Fetch-Site` が矛盾しないことを検査します。認証後のmutationはsessionに加えて `x-csrf-token` とD1上のCSRF hashを照合します。

すべてのauthorizationはroute/service/repositoryのserver側で行います。

- employee routeはemployee roleを要求する。
- admin routeはadmin roleを要求する。
- 本人操作はsession user IDを正とし、request bodyのuser IDを信用しない。
- record/requestの所有者をserver側で確認する。

### 4. login試行制限

`login_rate_limits` にaccount fingerprintとIP fingerprintを別々に保存します。15分windowで5回失敗すると15分blockします。emailとIP自体ではなくSHA-256 fingerprintをkeyにします。成功時はaccount側の失敗状態をclearします。

### 5. Sites accessとは分離

Sites accessは「production URLへ到達できる人」を制御し、アプリloginは「勤怠データへアクセスできるroleと本人性」を制御します。

- Phase 2はまずowner/admin限定accessでsmokeする。
- audienceを拡大してもアプリloginを外さない。
- `oai-authenticated-user-email` をこのPoCの従業員sessionへ自動変換しない。
- 将来Sign in with ChatGPTを追加する場合も、D1 userへの明示的linkとserver側authorizationを別ADRで設計する。

## HTTP Basicを採用しない理由

HTTP Basicはこの要件に適しません。

1. browserがcredential送信を管理し、アプリ単位の明確なlogin/logout UX、session失効、端末別session管理を実現しにくい。
2. requestごとに再利用可能なemail/password相当を送るため、短命なopaque sessionよりcredential露出時の影響が大きい。
3. employee/admin role、user無効化、所有者判定のために結局D1参照が必要で、Basicだけではauthorization modelを簡潔にできない。
4. demo account入力補助、login試行制限、generic error、session expiry、監査との統合が難しい。
5. `Authorization` headerをService Worker、proxy、log、debug toolingで誤って扱うriskを増やす。
6. Sites accessとアプリrole境界を独立に確認するsmokeが不明瞭になる。

TLSがBasic credentialを暗号化しても、上記のsession lifecycleとauthorization上の問題は解決しません。

## D1 sessionを採用した理由

signed cookieだけに全session状態を持つ案も採用しませんでした。D1 sessionなら次を一貫して実現できます。

- logout時の即時失効
- user無効化・role変更の反映
- expiryによるserver側拒否
- raw tokenを永続化しない
- CSRF token hashとの紐付け
- 複数Worker instanceから同じsession状態を参照
- 将来のsession一覧・強制logoutへの拡張

このPoCは既に勤怠データでD1を必要とするため、session専用の外部serviceを追加しません。

## Alternatives considered

### Sitesのworkspace identityだけを使う

OpenAI公式showcaseには `oai-authenticated-user-email` を使う内部tool例があります。[OpenAI Sites showcase: Sparkboard](https://learn.chatgpt.com/showcase/idea-intake) ただし本PoCの確定要件は公開demoでのemail/password login、架空employee/admin、アプリ固有roleです。workspace identityへの置換は要件変更になるため採用しません。

### Sign in with ChatGPTだけを使う

公開Siteに任意のSign in with ChatGPTを追加することは公式にsupportされていますが、このPoCの架空accountとroleを直接表しません。Phase 1では採用せず、将来のidentity provider追加として扱います。

### stateless signed session cookie

D1 readを減らせますが、logout・強制失効・user無効化・role変更の即時反映が難しくなり、signing secretのrotation設計も必要です。PoCの明確さとserver-side controlを優先して不採用です。

### 外部identity provider

一般公開向けには選択肢ですが、PoC scopeを超え、provider設定・redirect・account linking・Secret管理が増えます。Sites-ready Phase 1では追加しません。

## Consequences

### Positive

- Sitesの共有設定から独立したemployee/admin境界を持てる。
- logout、expiry、role、所有者、CSRFをserver側で強制できる。
- 公開demoでも通常の認証workflowを検証できる。
- D1にraw session/CSRF tokenやplain passwordを保存しない。
- repository・integration testで認証と勤怠を同じWorkers runtime上で確認できる。

### Negative / trade-offs

- 認証済みrequestごとにD1 session lookupが発生する。
- expired sessionの定期cleanup jobは未実装である。
- password reset、email verification、MFA、account provisioningはPoC対象外である。
- PBKDF2 600,000反復はWorkersのCPU時間とlogin latencyへ影響しうる。
- D1障害時はloginと認証済みAPIの両方が利用できない。
- 意図的に公開するdemo passwordであっても、通常環境のcredentialと混在させない運用が必要である。

Sites実行環境のPBKDF2上限に対する公開デモ限定の例外は、判断対象を分離して[ADR 0002](./0002-sites-public-demo-password-cost.md)に記録します。
