import { NextResponse } from 'next/server'

export async function GET() {
  const usageGuide = `
# サブスクリプション検索ボット利用ガイド

## 基本的な使い方（CSVファイル利用）

1. **CSVファイル準備**
   - 銀行やクレジットカードの取引履歴をCSV形式でエクスポート
   - 必要なカラム：「取引内容」「取引金額」「取引日」（類似名でも対応可能）

2. **ファイル送信**
   - LINEチャットでCSVファイルを送信
   - ボットが自動的にファイルを解析
   - 「CSVファイルの解析が完了しました」というメッセージが表示されます

3. **複数ファイル対応**
   - 複数の銀行やカード明細のCSVファイルを連続して送信可能
   - データは自動的に統合され、重複は除去されます
   - 最大24時間データが保持されます

4. **サブスク分析実行**
   - 「サブスク分析」と入力
   - アップロードしたすべてのデータから一括でサブスクリプションを検出
   - 分析結果が表示されます：
     * 検出されたサブスクリプションの数
     * 推定月額合計
     * 各サブスクリプションの詳細（取引内容、金額、確率、検出理由）

5. **データの削除**
   - 「データクリア」と入力すると保存されているデータがすべて削除されます

## 従来のMoneyForward連携による分析

1. **認証情報入力**
   - 「サブスク検索 メールアドレス パスワード」と入力
   - MoneyForwardのログイン情報を使用

2. **データ取得と分析**
   - 自動的にMoneyForwardからデータを取得
   - サブスクリプションを検出して表示

## コマンド一覧

- \`CSVファイル送信\`: 取引データをアップロード
- \`サブスク分析\`: アップロードしたデータからサブスクリプションを分析
- \`データクリア\`: 保存されたデータを削除
- \`サブスク検索 メールアドレス パスワード\`: MoneyForwardからデータを取得して分析
- \`ヘルプ\`: コマンド一覧を表示

## サブスクリプション検出の仕組み

サブスクリプション検出は以下の方法で行われます：

1. **キーワードマッチング**
   - Netflix、Spotify、Amazon Primeなどの一般的なサブスクリプションサービス名
   - 「月額」「定期購入」「プレミアム」などの特徴的なキーワード

2. **支払いパターンの分析**
   - 同じ金額の繰り返し支払いを検出
   - 少額（3,000円以下）の定期的な支払いを検出

3. **確率判定**
   - 各取引のサブスクリプション確率を0〜100%で表示
   - 複数の要素から総合的に判断

## 利用上の注意点

- CSVファイルは取引履歴のみを含み、個人情報は最小限にしてください
- データは24時間後に自動的に削除されます
- プライベートなチャットでの使用を推奨します
`

  // HTML形式で返す
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>サブスクリプション検索ボット 使い方</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
    }
    h2 {
      color: #3498db;
      margin-top: 30px;
    }
    ul, ol {
      padding-left: 25px;
    }
    li {
      margin-bottom: 8px;
    }
    code {
      background-color: #f8f8f8;
      padding: 2px 5px;
      border-radius: 3px;
      font-family: monospace;
    }
    .container {
      background-color: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      padding: 30px;
    }
    .note {
      background-color: #f8f9fa;
      border-left: 4px solid #3498db;
      padding: 15px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="content"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('content').innerHTML = marked.parse(\`${usageGuide}\`);
  </script>
</body>
</html>
`

  return new NextResponse(htmlContent, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}
