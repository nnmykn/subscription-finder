import { Readable } from 'node:stream'
import csvParser from 'csv-parser'
import { type NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright'
import streamToString from 'stream-to-string'
import iconv from 'iconv-lite'

interface CsvRow {
  計算対象: string
  日付: string
  内容: string
  金額: string
  保有金融機関: string
  大項目: string
  中項目: string
  メモ: string
  振替: string
  ID: string
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
          { error: '認証情報が不足しています' },
          { status: 400 },
      )
    }

    const browser = await chromium.launch({
      headless: false,
    })

    try {
      const context = await browser.newContext()
      const page = await context.newPage()

      await page.goto('https://moneyforward.com/sign_in')

      await page.fill('input[type="email"]', email)
      await page.click('button[id="submitto"]')

      await page.waitForSelector('input[type="password"]')
      await page.fill('input[type="password"]', password)
      await page.click('button[id="submitto"]')

      try {
        await page.waitForURL('https://moneyforward.com/**', { timeout: 10000 })
      } catch (error) {
        return NextResponse.json(
            { error: 'ログインに失敗しました。認証情報を確認してください。' },
            { status: 401 },
        )
      }

      const cookies = await context.cookies()
      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

      console.log('CSVデータを取得中...')

      const now = new Date()
      const allCsvData: string[] = []

      for (let i = 0; i < 6; i++) {
        const targetDate = new Date(now)
        targetDate.setMonth(now.getMonth() - i)

        const year = targetDate.getFullYear()
        const month = targetDate.getMonth() + 1

        const fromDate = `${year}%2F${month.toString().padStart(2, '0')}%2F01`
        const csvUrl = `https://moneyforward.com/cf/csv?from=${fromDate}&month=${month}&year=${year}`

        try {
          console.log(`${year}年${month}月のCSVデータを取得中...`)
          const response = await fetch(csvUrl, {
            headers: {
              Cookie: cookieString,
              'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
            },
          })

          if (!response.ok) {
            console.error(
                `${year}年${month}月のCSVデータの取得に失敗しました: ${response.status} ${response.statusText}`,
            )
            continue
          }

          // CSVデータをShift_JISとしてデコード
          const buffer = await response.arrayBuffer()
          const csvString = iconv.decode(Buffer.from(buffer), 'Shift_JIS')

          allCsvData.push(csvString)
          console.log(`${year}年${month}月のCSVデータを取得しました`)
        } catch (error) {
          console.error(
              `${year}年${month}月のCSVデータ取得中にエラーが発生しました:`,
              error,
          )
        }
      }

      if (allCsvData.length === 0) {
        throw new Error(
            'CSVデータの取得に失敗しました。有効なデータがありません。',
        )
      }

      console.log(`${allCsvData.length}ヶ月分のCSVデータが取得されました`)
      await browser.close()

      const csvString = allCsvData.join('\n')

      const results: CsvRow[] = []

      const stream = Readable.from([csvString])

      const stringData = await streamToString(stream)

      const readable = Readable.from([stringData])
      await new Promise<void>((resolve, reject) => {
        readable
            .pipe(csvParser({
              encoding: 'utf8',
              mapHeaders: ({ header }) => {
                // ヘッダー名を正規化
                const headerMap: Record<string, string> = {
                  '計算対象': '計算対象',
                  '日付': '日付',
                  '内容': '内容',
                  '金額（円）': '金額',
                  '保有金融機関': '保有金融機関',
                  '大項目': '大項目',
                  '中項目': '中項目',
                  'メモ': 'メモ',
                  '振替': '振替',
                  'ID': 'ID'
                }
                return headerMap[header] || header
              }
            }))
            .on('data', (row: CsvRow) => {
              results.push(row)
            })
            .on('end', () => {
              resolve()
            })
            .on('error', (err) => {
              console.error('CSV解析エラー:', err)
              reject(err)
            })
      })

      // 段階的な分析を行う
      type AnalysisResult = {
        取引内容: string
        取引金額: string
        取引日: string
        キーワード: string[]
        サブスク確率: number
        理由: string
        グループID?: string // 類似取引グループを識別するID
      }

      const analyzeTransactions = async (): Promise<AnalysisResult[]> => {
        // 拡張されたデータ型
        interface PreprocessedData extends CsvRow {
          keywords: string[]
          normalizedContent: string // 正規化した取引内容
          tokenizedContent: string[] // トークン化した取引内容
          initialScore?: number
          initialReason?: string
          amountValue: number // 数値化した金額
          isExpense: boolean // 支出かどうか
        }

        // デバッグログ追加
        console.log(`取引データ総数: ${results.length}件`);

        // ステップ1: データの前処理と正規化
        const preprocessedData: PreprocessedData[] = []

        for (const row of results) {
          try {
            const content = row.内容 || '';

            // 取引内容を正規化
            const normalizedContent = normalizeContent(content);

            // キーワード抽出を改善（区切り文字を拡張）
            const keywords = content.split(/[\s・,.、。:：\/\(\)（）「」]/g)
                .filter(Boolean)
                .map(k => k.toLowerCase());

            // 単語への分解（日本語と英語両方に対応）
            const tokenizedContent = tokenizeContent(content);

            // 金額を数値化
            let amountValue = 0;
            let isExpense = false;
            try {
              // 金額からカンマや記号（マイナス以外）を除去し、数値のみを抽出
              // マイナス記号は残す
              const amountStr = (row.金額 || '').replace(/[^0-9\-]/g, '');

              // 先頭が"-"で始まる場合は支出、そうでなければ収入
              isExpense = amountStr.startsWith('-');

              // 絶対値を取得
              amountValue = Math.abs(parseInt(amountStr, 10));
            } catch (e) {
              console.error('金額のパースに失敗:', row.金額);
            }

            preprocessedData.push({
              ...row,
              keywords,
              normalizedContent,
              tokenizedContent,
              amountValue,
              isExpense
            });
          } catch (e) {
            console.error('データの前処理に失敗:', e);
          }
        }

        // サブスク検出関数（修正版）
        const detectSubscription = (data: PreprocessedData): AnalysisResult => {
          // 基本スコアを0から始める
          let score = 0;
          const reasons: string[] = [];

          const content = (data.内容 || '').toLowerCase();
          const memo = (data.メモ || '').toLowerCase();
          const category = ((data.大項目 || '') + (data.中項目 || '')).toLowerCase();
          const combinedText = content + ' ' + memo;

          // 名前が100文字を超える場合はAmazonの注文の可能性があるため除外
          if (data.内容 && data.内容.length > 100) {
            return {
              取引内容: data.内容 || '',
              取引金額: data.金額 || '',
              取引日: data.日付 || '',
              キーワード: data.keywords,
              サブスク確率: 0,
              理由: '内容が100文字を超えるためAmazonの注文の可能性があり除外',
            };
          }

          // 重要: 収入（入金）は基本的にサブスクではないので、初期段階で除外
          if (!data.isExpense) {
            score = 0; // スコアを0に設定
            reasons.push('収入（入金）のためサブスクリプションではない');

            // 実際のサブスク返金のみを特定するための厳格な条件
            // これらの特定の文字列を含む場合のみ考慮する
            const subscriptionRefunds = [
              'netflix返金', 'spotify返金', 'amazon prime返金', 'youtube premium返金',
              'サブスク返金', 'subscription refund', 'prime返金', 'disney+返金'
            ];

            const isSubscriptionRefund = subscriptionRefunds.some(term =>
                combinedText.includes(term)
            );

            if (!isSubscriptionRefund) {
              // 入金でサブスク返金でない場合は早期リターン
              return {
                取引内容: data.内容 || '',
                取引金額: data.金額 || '',
                取引日: data.日付 || '',
                キーワード: data.keywords,
                サブスク確率: 0, // 確実に0
                理由: '収入（入金）のためサブスクリプションではない',
              };
            }
          }

          // 典型的なサブスクではない取引を識別
          if (
              content.includes('チャージ') ||
              content.includes('ポイント') ||
              content.includes('振込') ||
              content.includes('給与') ||
              content.includes('給料') ||
              content.includes('割引') ||
              content.includes('atm') ||
              content.includes('出金') ||
              content.includes('入金') ||
              content.includes('返金') ||
              content.includes('キャッシュバック')
          ) {
            // サブスクではない取引の特徴が見つかった場合、早期リターン
            return {
              取引内容: data.内容 || '',
              取引金額: data.金額 || '',
              取引日: data.日付 || '',
              キーワード: data.keywords,
              サブスク確率: 0, // 確実に0
              理由: `「${content}」はサブスクリプションではない可能性が高い`,
            };
          }

          // 実際のサブスクサービス名のリスト - これらは高いスコアを持つべき
          const actualSubscriptionServices = [
            // 動画/音楽ストリーミング
            { name: 'netflix', score: 0.95 },
            { name: 'ネットフリックス', score: 0.95 },
            { name: 'spotify', score: 0.95 },
            { name: 'スポティファイ', score: 0.95 },
            { name: 'amazon prime', score: 0.95 },
            { name: 'prime video', score: 0.95 },
            { name: 'プライムビデオ', score: 0.95 },
            { name: 'youtube premium', score: 0.95 },
            { name: 'ユーチューブプレミアム', score: 0.95 },
            { name: 'disney+', score: 0.95 },
            { name: 'ディズニープラス', score: 0.95 },
            { name: 'hulu', score: 0.95 },
            { name: 'フールー', score: 0.95 },
            { name: 'dazn', score: 0.95 },
            { name: 'apple music', score: 0.95 },
            { name: 'アップルミュージック', score: 0.95 },
            { name: 'u-next', score: 0.95 },
            { name: 'unext', score: 0.95 },
            { name: 'abema premium', score: 0.95 },
            { name: 'abemaプレミアム', score: 0.95 },

            // ソフトウェア/クラウド
            { name: 'microsoft 365', score: 0.95 },
            { name: 'office 365', score: 0.95 },
            { name: 'adobe', score: 0.95 },
            { name: 'creative cloud', score: 0.95 },
            { name: 'google one', score: 0.95 },
            { name: 'icloud+', score: 0.95 },
            { name: 'dropbox', score: 0.95 },
            { name: 'evernote', score: 0.95 },
            { name: 'notion', score: 0.95 },

            // AI/開発サービス
            { name: 'chatgpt', score: 0.95 },
            { name: 'openai', score: 0.95 },
            { name: 'github', score: 0.95 },
            { name: 'gitlab', score: 0.95 },
            { name: 'claude', score: 0.95 },
            { name: 'anthropic', score: 0.95 },

            // 通信/インターネット
            { name: 'nuro', score: 0.9 },
            { name: 'ソフトバンク', score: 0.9 },
            { name: 'docomo', score: 0.9 },
            { name: 'ドコモ', score: 0.9 },
            { name: 'au', score: 0.9 },
            { name: '楽天モバイル', score: 0.9 },
            { name: 'wimax', score: 0.9 },

            // メディア/情報
            { name: '日経', score: 0.9 },
            { name: '朝日新聞', score: 0.9 },
            { name: '読売新聞', score: 0.9 },
            { name: 'kindle unlimited', score: 0.9 },
            { name: 'audible', score: 0.9 },

            // その他のサブスク
            { name: 'サブスクリプション', score: 0.95 },
            { name: 'subscription', score: 0.95 },
            { name: 'サブスク', score: 0.95 },
            { name: '月額', score: 0.9 },
            { name: '年額', score: 0.9 }
          ];

          // まず実際のサブスクサービス名をチェック
          for (const service of actualSubscriptionServices) {
            if (combinedText.includes(service.name)) {
              score = Math.max(score, service.score);
              reasons.push(`「${service.name}」を含むサブスクリプションサービス`);
            }
          }

          // 明示的なサブスク表現をチェック
          const subscriptionIndicators = [
            { indicator: '月額', score: 0.8 },
            { indicator: '年額', score: 0.8 },
            { indicator: '自動更新', score: 0.8 },
            { indicator: '定期', score: 0.7 },
            { indicator: 'プレミアム', score: 0.7 },
            { indicator: 'premium', score: 0.7 },
            { indicator: 'メンバーシップ', score: 0.7 },
            { indicator: '契約', score: 0.5 }
          ];

          for (const { indicator, score: indicatorScore } of subscriptionIndicators) {
            if (combinedText.includes(indicator)) {
              score = Math.max(score, indicatorScore);
              reasons.push(`「${indicator}」を含む（サブスクの可能性が高い）`);
            }
          }

          // カテゴリによる判定
          const subscriptionCategories = [
            { category: '通信', score: 0.6 },
            { category: 'エンタメ', score: 0.6 },
            { category: 'ソフトウェア', score: 0.7 },
            { category: '定額', score: 0.7 },
            { category: '月額', score: 0.7 },
            { category: '年額', score: 0.7 }
          ];

          for (const { category: cat, score: categoryScore } of subscriptionCategories) {
            if ((data.大項目 || '').includes(cat) || (data.中項目 || '').includes(cat)) {
              score = Math.max(score, categoryScore);
              reasons.push(`サブスクに関連するカテゴリ（${cat}）`);
            }
          }

          // スコアが最低閾値未満の場合は早期リターン
          if (score < 0.4) {
            return {
              取引内容: data.内容 || '',
              取引金額: data.金額 || '',
              取引日: data.日付 || '',
              キーワード: data.keywords,
              サブスク確率: score,
              理由: reasons.length > 0 ? reasons.join('、') : 'サブスクリプションの特徴が見つからない',
            };
          }

          // ここから先は一定のスコアがあるものだけが処理される

          // 金額による判定（補助的な判断基準）
          const amount = data.amountValue;
          if (amount > 0) {
            // よく見られるサブスク金額（特に月額）
            const commonMonthlyPrices = [
              298, 299, 300, 350, 380, 398, 399,
              400, 480, 490, 498, 499, 500, 550,
              580, 598, 599, 600, 700, 800, 900,
              980, 990, 998, 999, 1000, 1100, 1200,
              1380, 1480, 1500, 1650, 1800, 1950,
              1980, 2000
            ];

            // 完全一致または近い金額
            if (commonMonthlyPrices.includes(amount)) {
              score = Math.max(score, score + 0.1);
              reasons.push(`一般的なサブスク金額（${amount}円）に一致`);
            } else {
              // 近い金額（±50円）
              const closestAmount = commonMonthlyPrices.find(a => Math.abs(a - amount) <= 50);
              if (closestAmount) {
                score = Math.max(score, score + 0.05);
                reasons.push(`サブスク金額（${closestAmount}円）に近い金額（${amount}円）`);
              }
            }
          }

          return {
            取引内容: data.内容 || '',
            取引金額: data.金額 || '',
            取引日: data.日付 || '',
            キーワード: data.keywords,
            サブスク確率: score,
            理由: reasons.join('、'),
          };
        };

        // 初期分析
        const allResults = preprocessedData.map(detectSubscription);

        // デバッグ: 初期スコア分布を確認
        const scoreDistribution = {
          '>0.7': allResults.filter(r => r.サブスク確率 > 0.7).length,
          '0.5-0.7': allResults.filter(r => r.サブスク確率 >= 0.5 && r.サブスク確率 <= 0.7).length,
          '0.3-0.5': allResults.filter(r => r.サブスク確率 >= 0.3 && r.サブスク確率 < 0.5).length,
          '0.1-0.3': allResults.filter(r => r.サブスク確率 >= 0.1 && r.サブスク確率 < 0.3).length,
          '<0.1': allResults.filter(r => r.サブスク確率 < 0.1).length,
        };
        console.log('初期スコア分布:', scoreDistribution);

        // サブスクである可能性の高いアイテムだけをフィルター
        const potentialSubscriptions = allResults.filter(result => result.サブスク確率 >= 0.4);
        console.log(`潜在的サブスク候補数: ${potentialSubscriptions.length}件`);

        // 取引内容の類似性を判定する関数
        const isSimilarContent = (content1: string, content2: string): number => {
          // 空の場合は比較不能
          if (!content1 || !content2) return 0;

          // 正規化（大文字小文字、記号、数字を取り除く）
          const normalize = (str: string) => {
            return str.toLowerCase()
                .replace(/[\s\-_・.,:;\/\(\)（）「」\[\]【】]/g, '') // 記号除去
                .replace(/[0-9０-９]/g, ''); // 数字除去
          };

          const norm1 = normalize(content1);
          const norm2 = normalize(content2);

          // 短すぎる文字列の場合は特別処理
          if (norm1.length < 2 || norm2.length < 2) {
            return norm1 === norm2 ? 1 : 0;
          }

          // 完全一致
          if (norm1 === norm2) return 1;

          // 一方が他方に含まれる場合
          if (norm1.includes(norm2) || norm2.includes(norm1)) {
            // 短い方の文字列の長さを取得
            const shortLength = Math.min(norm1.length, norm2.length);
            // 長い方の文字列の長さを取得
            const longLength = Math.max(norm1.length, norm2.length);
            // 含有率を計算（短い文字列がどれだけ長い文字列に含まれているか）
            return shortLength / longLength * 0.9; // 0.9を掛けて完全一致より少し下げる
          }

          // 1語だけのブランド名などを検出（例：「Amazon」と「Amazonプライム」）
          const tokens1 = norm1.match(/[a-z]+|[ぁ-んァ-ン一-龥]+/g) || [];
          const tokens2 = norm2.match(/[a-z]+|[ぁ-んァ-ン一-龥]+/g) || [];

          // トークン間の一致をチェック
          const matchingTokens = tokens1.filter(t => tokens2.includes(t));
          if (matchingTokens.length > 0) {
            // 一致するトークンの文字数の合計
            const matchingLength = matchingTokens.reduce((sum, token) => sum + token.length, 0);
            // 両方のトークンの文字数の合計
            const totalLength = tokens1.concat(tokens2).reduce((sum, token) => sum + token.length, 0);
            // 一致率を計算
            const tokenSimilarity = (matchingLength * 2) / totalLength;

            // 重要なブランド名の場合、類似度を上げる
            const importantTokens = ['amazon', 'netflix', 'spotify', 'apple', 'google', 'microsoft',
              'アマゾン', 'ネットフリックス', 'スポティファイ', 'アップル', 'グーグル', 'マイクロソフト'];
            const hasImportantToken = matchingTokens.some(t => importantTokens.includes(t));

            return hasImportantToken ? Math.max(0.7, tokenSimilarity) : tokenSimilarity;
          }

          // 編集距離による類似度チェック
          const maxLength = Math.max(norm1.length, norm2.length);
          if (maxLength === 0) return 0;

          const distance = levenshteinDistance(norm1, norm2);
          const similarity = 1 - distance / maxLength;

          return similarity;
        };

        // 日付文字列をパースする関数
        const parseDate = (dateStr: string): Date | null => {
          if (!dateStr) return null;

          try {
            // 日付形式を正規化
            if (dateStr.includes('/')) {
              // YYYY/MM/DD形式
              const parts = dateStr.split('/');
              if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                return new Date(year, month, day);
              }
            } else if (dateStr.includes('-')) {
              // YYYY-MM-DD形式
              return new Date(dateStr);
            } else if (/^\d{8}$/.test(dateStr)) {
              // YYYYMMDD形式
              const year = parseInt(dateStr.substring(0, 4), 10);
              const month = parseInt(dateStr.substring(4, 6), 10) - 1;
              const day = parseInt(dateStr.substring(6, 8), 10);
              return new Date(year, month, day);
            }

            // その他の形式はJavaScriptのDateにパースを任せる
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? null : date;
          } catch (e) {
            console.error('日付のパースに失敗:', dateStr, e);
            return null;
          }
        };

        // サービス名をベースにしたグループ化関数を追加
        const groupByService = (results: AnalysisResult[]): AnalysisResult[] => {
          // サービス名の抽出関数
          const extractServiceName = (content: string): string => {
            content = content.toLowerCase();

            // 既知のサービス名のマッピング
            const servicePatterns = [
              { pattern: /netflix/i, name: 'Netflix' },
              { pattern: /spotify/i, name: 'Spotify' },
              { pattern: /amazon prime|prime video/i, name: 'Amazon Prime' },
              { pattern: /disney\+|ディズニープラス/i, name: 'Disney+' },
              { pattern: /kindle/i, name: 'Kindle Unlimited' },
              { pattern: /adobe/i, name: 'Adobe' },
              { pattern: /google/i, name: 'Google' },
              { pattern: /microsoft|office 365/i, name: 'Microsoft' },
              { pattern: /claude/i, name: 'Claude AI' },
              { pattern: /chatgpt|openai/i, name: 'OpenAI' },
              { pattern: /apple/i, name: 'Apple' },
              { pattern: /docomo|ドコモ/i, name: 'Docomo' },
              { pattern: /softbank|ソフトバンク/i, name: 'SoftBank' },
              { pattern: /au/i, name: 'au' },
              { pattern: /1password/i, name: '1Password' }
            ];

            for (const { pattern, name } of servicePatterns) {
              if (pattern.test(content)) {
                return name;
              }
            }

            // 既知のパターンに当てはまらない場合は内容そのものを返す
            return content;
          };

          // サービス名ごとのグループを作成
          const serviceGroups: Record<string, AnalysisResult[]> = {};

          results.forEach(result => {
            const serviceName = extractServiceName(result.取引内容);
            if (!serviceGroups[serviceName]) {
              serviceGroups[serviceName] = [];
            }
            serviceGroups[serviceName].push(result);
          });

          // 各グループにIDを付与
          const groupedResults: AnalysisResult[] = [];
          let groupIdCounter = 1;

          Object.entries(serviceGroups).forEach(([serviceName, group]) => {
            if (group.length > 0) {
              const groupId = `group-${groupIdCounter++}`;

              group.forEach(result => {
                groupedResults.push({
                  ...result,
                  グループID: groupId
                });
              });
            }
          });

          return groupedResults;
        };

        // 日付パターン分析の改良関数
        const analyzeDatePatterns = (groups: Record<string, number>) => {
          // 各グループの日付パターンを分析
          Object.entries(groups).forEach(([groupId, count]) => {
            // 1つしかない場合はスキップ
            if (count <= 1) return;

            // このグループの全アイテムを取得
            const groupItems = groupedResults.filter(r => r.グループID === groupId);

            // 入金項目は処理しない
            if (groupItems.some(item => item.理由.includes('入金') || item.理由.includes('収入'))) {
              return;
            }

            // 明らかにサブスクでないものは処理しない
            const nonSubscriptionKeywords = ['チャージ', 'ポイント', '振込', '給与', '給料', '割引', '返金'];
            if (groupItems.some(item => {
              const content = item.取引内容.toLowerCase();
              return nonSubscriptionKeywords.some(keyword => content.includes(keyword));
            })) {
              return;
            }

            // 日付をパースして確実にソート
            const validDates: { result: AnalysisResult; date: Date }[] = [];

            for (const result of groupItems) {
              const date = parseDate(result.取引日);
              if (date && !isNaN(date.getTime())) {
                validDates.push({ result, date });
              }
            }

            // 有効な日付が足りない場合はスキップ
            if (validDates.length < 2) return;

            // 日付でソート
            validDates.sort((a, b) => a.date.getTime() - b.date.getTime());

            // 月ごとにグループ化
            const monthlyGroups: Record<string, AnalysisResult[]> = {};

            validDates.forEach(({ result, date }) => {
              const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              if (!monthlyGroups[monthKey]) {
                monthlyGroups[monthKey] = [];
              }
              monthlyGroups[monthKey].push(result);
            });

            // 連続する月数をカウント
            const months = Object.keys(monthlyGroups).sort();

            // 最大連続月数を計算
            let maxConsecutiveMonths = 1;
            let currentConsecutive = 1;

            for (let i = 1; i < months.length; i++) {
              const prevDate = new Date(months[i-1] + '-01');
              const currDate = new Date(months[i] + '-01');

              // 次の月かどうかをチェック
              const nextMonthDate = new Date(prevDate);
              nextMonthDate.setMonth(prevDate.getMonth() + 1);

              const isNextMonth =
                  nextMonthDate.getFullYear() === currDate.getFullYear() &&
                  nextMonthDate.getMonth() === currDate.getMonth();

              if (isNextMonth) {
                currentConsecutive++;
                maxConsecutiveMonths = Math.max(maxConsecutiveMonths, currentConsecutive);
              } else {
                currentConsecutive = 1;
              }
            }

            // 日数の差を計算
            const dateDiffs: number[] = [];

            for (let i = 1; i < validDates.length; i++) {
              const prevDate = validDates[i-1].date;
              const currDate = validDates[i].date;
              const diffTime = Math.abs(currDate.getTime() - prevDate.getTime());
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              dateDiffs.push(diffDays);
            }

            // 定期的なパターンを検出
            const monthlyPattern = dateDiffs.some(diff => diff >= 28 && diff <= 32);
            const yearlyPattern = dateDiffs.some(diff => diff >= 350 && diff <= 380);

            // ボーナススコア計算
            let patternBonus = 0;

            // 月次パターンを検出
            if (monthlyPattern) {
              patternBonus = 0.3;

              // 3ヶ月以上連続で月次パターンがある場合
              if (maxConsecutiveMonths >= 3) {
                patternBonus = 0.5;
              }
            }
            // 年次パターン
            else if (yearlyPattern) {
              patternBonus = 0.3;
            }

            // このグループの全アイテムのスコアを更新
            groupItems.forEach(result => {
              // サブスクと判断されているもののみスコアを更新（0.5以上）
              if (result.サブスク確率 >= 0.5) {
                const index = groupedResults.findIndex(r =>
                    r.取引内容 === result.取引内容 &&
                    r.取引金額 === result.取引金額 &&
                    r.取引日 === result.取引日
                );

                if (index >= 0) {
                  const oldScore = groupedResults[index].サブスク確率;
                  groupedResults[index].サブスク確率 = Math.min(1, oldScore + patternBonus);

                  // 理由を追加
                  if (monthlyPattern) {
                    groupedResults[index].理由 += `、月次の支払いパターンを検出（${maxConsecutiveMonths}ヶ月連続）`;
                  } else if (yearlyPattern) {
                    groupedResults[index].理由 += '、年次の支払いパターンを検出';
                  }
                }
              }
            });
          });
        };

        // 最終確認フィルター - 明らかに間違っているものを除外
        const filterFinalResults = (results: AnalysisResult[]): AnalysisResult[] => {
          // 高確率サブスクを保存（グループなしでも高確率なら残す）
          const highProbabilitySubscriptions = potentialSubscriptions.filter(result => {
            const content = (result.取引内容 || '').toLowerCase();

            // 名前が100文字を超える場合はAmazonの注文の可能性があるため除外
            if (result.取引内容 && result.取引内容.length > 100) {
              return false;
            }

            // 収入や返金、チャージなどの取引は除外
            if (result.理由.includes('入金') || result.理由.includes('収入')) {
              return false;
            }

            // 特定のキーワードを含む取引は除外
            const exclusionKeywords = [
              'ポイント', 'チャージ', '振込', '給与', '給料',
              '割引', '返金', 'atm', '出金', 'キャッシュバック'
            ];

            if (exclusionKeywords.some(keyword => content.includes(keyword))) {
              return false;
            }

            // 確率が0.7以上の明らかなサブスクは維持する
            if (result.サブスク確率 >= 0.7) {
              return true;
            }

            // 特定の明確なサブスクサービス名を含む場合も維持
            const definiteServices = [
              'netflix', 'spotify', 'amazon prime', 'disney', 'kindle',
              'adobe', 'google', 'claude', 'chatgpt', 'office'
            ];

            if (definiteServices.some(service => content.includes(service))) {
              return true;
            }

            // それ以外の場合は0.5未満は除外
            return result.サブスク確率 >= 0.5;
          });

          // グループ化された結果と高確率サブスクを合わせる
          const combinedResults = new Map<string, AnalysisResult>();

          // まずグループ化された結果を追加
          results.forEach(result => {
            const key = `${result.取引内容}-${result.取引金額}-${result.取引日}`;
            combinedResults.set(key, result);
          });

          // 次に高確率サブスクを追加（既存のキーは上書きしない）
          highProbabilitySubscriptions.forEach(result => {
            const key = `${result.取引内容}-${result.取引金額}-${result.取引日}`;
            if (!combinedResults.has(key)) {
              combinedResults.set(key, result);
            }
          });

          return Array.from(combinedResults.values());
        };

        // サブスク確率が0.4以上の潜在的なサブスクをログ出力
        console.log('潜在的サブスク', JSON.stringify(potentialSubscriptions, null, 2));

        // グループ化の処理を改善
        // 新しいサービス名ベースのグループ化を適用
        const groupedResults = groupByService(potentialSubscriptions);

        // 日付パターン分析のためのグループカウント
        const groupCounts: Record<string, number> = {};
        groupedResults.forEach(result => {
          if (result.グループID) {
            groupCounts[result.グループID] = (groupCounts[result.グループID] || 0) + 1;
          }
        });

        // グループ数を出力
        console.log(`グループ数: ${Object.keys(groupCounts).length}`);
        console.log(`複数回出現するグループ数: ${Object.values(groupCounts).filter(count => count > 1).length}`);

        // 日付パターン分析を実行
        analyzeDatePatterns(groupCounts);

        // 最終フィルターを適用
        const finalResults = filterFinalResults(groupedResults);
        return finalResults.sort((a, b) => b.サブスク確率 - a.サブスク確率);
      };

      // テキスト正規化関数
      function normalizeContent(text: string): string {
        return text.toLowerCase()
            .replace(/[\s\-_・.,:;\/\(\)（）「」\[\]【】]/g, '')
            .replace(/[0-9０-９]/g, '');
      }

      // トークン化関数（単語に分解）
      function tokenizeContent(text: string): string[] {
        // 英数字、日本語（ひらがな、カタカナ、漢字）に対応
        const tokens = text.match(/[a-zA-Z0-9]+|[ぁ-んァ-ン一-龥]+/g) || [];
        return tokens.map(t => t.toLowerCase());
      }

      // Levenshtein距離を計算する関数
      function levenshteinDistance(str1: string, str2: string): number {
        const m = str1.length;
        const n = str2.length;

        // コスト行列を初期化
        const d: number[][] = Array(m + 1)
            .fill(null)
            .map(() => Array(n + 1).fill(0));

        // 行と列の初期化
        for (let i = 0; i <= m; i++) d[i][0] = i;
        for (let j = 0; j <= n; j++) d[0][j] = j;

        // 編集距離を計算
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,      // 削除
                d[i][j - 1] + 1,      // 挿入
                d[i - 1][j - 1] + cost // 置換または一致
            );
          }
        }

        return d[m][n];
      }

      const analysisResults = await analyzeTransactions()

      console.log({ analysisResults })

      // 結果がない場合は不明なサービス名を修正
      let finalAnalysisResults = analysisResults;

      // 不明な取引内容の表示名を改善
      const enhancedResults = finalAnalysisResults.map(result => {
        // 取引内容が空の場合は「不明なサービス」として表示
        if (!result.取引内容 || result.取引内容.trim() === '') {
          return {
            ...result,
            取引内容: '不明なサービス'
          };
        }
        return result;
      });

      return NextResponse.json({
        results: enhancedResults,
        allTransactions: results.length,
        subscriptionCount: enhancedResults.length,
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('エラーが発生しました:', error)
    return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 },
    )
  }
}