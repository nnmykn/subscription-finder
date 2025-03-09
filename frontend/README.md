# サブスクリプション検索アプリ

## 概要

このアプリケーションは、MoneyForwardから取得した取引データを分析し、サブスクリプションサービスを識別するツールです。LINEボットを通じてサブスクリプション情報を簡単に取得できます。

## セットアップ

### 必要条件

- Node.js (18.x以上)
- Yarn

### インストール

```bash
# 依存関係のインストール
yarn install
```

### 環境変数の設定

`.env.example`ファイルを`.env`にコピーし、必要な環境変数を設定します：

```bash
cp .env.example .env
```

以下の環境変数を設定してください：

- `NEXT_PUBLIC_API_URL`: アプリケーションのベースURL
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Developersコンソールで取得したチャネルアクセストークン
- `LINE_CHANNEL_SECRET`: LINE Developersコンソールで取得したチャネルシークレット

### 開発サーバーの起動

```bash
yarn dev
```

## LINE Botの設定方法

1. [LINE Developers Console](https://developers.line.biz/console/)にアクセスし、アカウントを作成またはログインします。
2. 新しいプロバイダーを作成し、その下にMessaging APIチャネルを作成します。
3. チャネル設定から以下の情報を取得し、`.env`ファイルに設定します：
   - チャネルシークレット (`LINE_CHANNEL_SECRET`)
   - チャネルアクセストークン (`LINE_CHANNEL_ACCESS_TOKEN`)
4. Webhook設定セクションで、WebhookのURLを設定します：
   - 開発環境では、[ngrok](https://ngrok.com/)などのツールを使用して一時的なパブリックURLを作成できます
   - WebhookのURLは `https://あなたのドメイン/api/line-webhook` の形式になります
5. Webhook設定の「Webhookの利用」を有効にします
6. 必要に応じて、応答メッセージを無効にします（ボットが自動的に応答するため）

## LINE Botの使い方

1. QRコードを読み取るか、LINEで友だち追加してボットと友だちになります
2. 以下のコマンドでサブスクリプション情報を取得できます：
   ```
   サブスク検索 メールアドレス パスワード
   ```
   ※メールアドレスとパスワードはMoneyForwardのログイン情報です

3. ボットがMoneyForwardからデータを取得し、サブスクリプションの可能性が高い取引を一覧表示します

## セキュリティ上の注意

- LINEでの認証情報の送信は、プライベートなチャットで行ってください
- 本番環境では、OAuth認証など、より安全な認証方法の実装を検討してください