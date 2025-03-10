import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'サブスクリプション検索ボット | 使い方ガイド',
  description:
    'LINEサブスクリプション検索ボットの使い方ガイド。CSVファイルのアップロードや複数ファイルの統合、サブスクリプション分析方法について説明します。',
}

export default function Usage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-800">
            サブスクリプション検索ボット
          </h1>
          <p className="text-gray-600 mt-1">
            あなたのサブスクリプションを簡単に発見・管理
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-6 md:p-8">
          <h1 className="text-3xl font-bold text-gray-900 border-b pb-4 mb-6">
            使い方ガイド
          </h1>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">
              基本的な使い方（CSVファイル利用）
            </h2>

            <ol className="list-decimal pl-6 space-y-4">
              <li className="pl-2">
                <div className="font-medium">CSVファイル準備</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>
                    銀行やクレジットカードの取引履歴をCSV形式でエクスポート
                  </li>
                  <li>
                    必要なカラム：「取引内容」「取引金額」「取引日」（類似名でも対応可能）
                  </li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">ファイル送信</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>LINEチャットでCSVファイルを送信</li>
                  <li>ボットが自動的にファイルを解析</li>
                  <li>
                    「CSVファイルの解析が完了しました」というメッセージが表示されます
                  </li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">複数ファイル対応</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>複数の銀行やカード明細のCSVファイルを連続して送信可能</li>
                  <li>データは自動的に統合され、重複は除去されます</li>
                  <li>最大24時間データが保持されます</li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">サブスク分析実行</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>「サブスク分析」と入力</li>
                  <li>
                    アップロードしたすべてのデータから一括でサブスクリプションを検出
                  </li>
                  <li>
                    分析結果が表示されます：
                    <ul className="list-disc pl-6 mt-1">
                      <li>検出されたサブスクリプションの数</li>
                      <li>推定月額合計</li>
                      <li>
                        各サブスクリプションの詳細（取引内容、金額、確率、検出理由）
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">データの削除</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>
                    「データクリア」と入力すると保存されているデータがすべて削除されます
                  </li>
                </ul>
              </li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">
              従来のMoneyForward連携による分析
            </h2>

            <ol className="list-decimal pl-6 space-y-4">
              <li className="pl-2">
                <div className="font-medium">認証情報入力</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>「サブスク検索 メールアドレス パスワード」と入力</li>
                  <li>MoneyForwardのログイン情報を使用</li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">データ取得と分析</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>自動的にMoneyForwardからデータを取得</li>
                  <li>サブスクリプションを検出して表示</li>
                </ul>
              </li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">
              コマンド一覧
            </h2>

            <div className="bg-gray-50 p-4 rounded-lg">
              <ul className="space-y-2">
                <li>
                  <code className="bg-gray-200 px-2 py-1 rounded text-red-600">
                    CSVファイル送信
                  </code>
                  : 取引データをアップロード
                </li>
                <li>
                  <code className="bg-gray-200 px-2 py-1 rounded text-red-600">
                    サブスク分析
                  </code>
                  : アップロードしたデータからサブスクリプションを分析
                </li>
                <li>
                  <code className="bg-gray-200 px-2 py-1 rounded text-red-600">
                    データクリア
                  </code>
                  : 保存されたデータを削除
                </li>
                <li>
                  <code className="bg-gray-200 px-2 py-1 rounded text-red-600">
                    サブスク検索 メールアドレス パスワード
                  </code>
                  : MoneyForwardからデータを取得して分析
                </li>
                <li>
                  <code className="bg-gray-200 px-2 py-1 rounded text-red-600">
                    ヘルプ
                  </code>
                  : コマンド一覧を表示
                </li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">
              サブスクリプション検出の仕組み
            </h2>

            <ol className="list-decimal pl-6 space-y-4">
              <li className="pl-2">
                <div className="font-medium">キーワードマッチング</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>
                    Netflix、Spotify、Amazon
                    Primeなどの一般的なサブスクリプションサービス名
                  </li>
                  <li>
                    「月額」「定期購入」「プレミアム」などの特徴的なキーワード
                  </li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">支払いパターンの分析</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>同じ金額の繰り返し支払いを検出</li>
                  <li>少額（3,000円以下）の定期的な支払いを検出</li>
                </ul>
              </li>

              <li className="pl-2">
                <div className="font-medium">確率判定</div>
                <ul className="list-disc pl-6 mt-2 text-gray-700">
                  <li>各取引のサブスクリプション確率を0〜100%で表示</li>
                  <li>複数の要素から総合的に判断</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-blue-600 mb-4">
              利用上の注意点
            </h2>

            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
              <ul className="list-disc pl-6 text-gray-700">
                <li>
                  CSVファイルは取引履歴のみを含み、個人情報は最小限にしてください
                </li>
                <li>データは24時間後に自動的に削除されます</li>
                <li>プライベートなチャットでの使用を推奨します</li>
              </ul>
            </div>
          </section>

          <div className="mt-12 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-xl font-semibold text-blue-700 mb-2">
              LINE Botを友だち追加
            </h3>
            <p className="text-gray-700 mb-4">
              以下のボタンからLINE
              Botを友だち追加して、サブスクリプションの管理を始めましょう。
            </p>
            <a
              href="https://lin.ee/YOUR_LINE_ID"
              className="inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              LINE Botを友だち追加
            </a>
          </div>
        </div>
      </main>

      <footer className="bg-gray-800 text-white py-6 mt-12">
        <div className="max-w-5xl mx-auto px-4">
          <p className="text-center">
            © {new Date().getFullYear()} サブスクリプション検索ボット
          </p>
        </div>
      </footer>
    </div>
  )
}
