import { Readable } from 'node:stream'
import csvParser from 'csv-parser'
import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { chromium } from 'playwright'
import streamToString from 'stream-to-string'

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

      for (let i = 0; i < 3; i++) {
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

          const csvString = await response.text()
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
          .pipe(csvParser())
          .on('data', (row: CsvRow) => {
            results.push(row)
          })
          .on('end', () => {
            resolve()
          })
          .on('error', (err) => {
            reject(err)
          })
      })

      const openai = new OpenAI({
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: 'sk-112712b0713746abbd86a7582a4ea616',
      })

      // 段階的な分析を行う
      type AnalysisResult = {
        取引内容: string
        取引金額: string
        取引日: string
        キーワード: string[]
        サブスク確率: number
        理由: string
      }

      const analyzeTransactions = async (): Promise<AnalysisResult[]> => {
        // 拡張されたデータ型の定義
        interface PreprocessedData extends CsvRow {
          keywords: string[]
          initialScore?: number
          initialReason?: string
        }

        // ステップ1: 各取引を前処理して、キーワードを抽出
        const preprocessedData: PreprocessedData[] = results.map((row) => {
          const content = row.内容 || ''
          const keywords = content.split(/\s+/).filter(Boolean)
          return {
            ...row,
            keywords,
          }
        })

        // よく知られているサブスクリプションサービスのパターン
        const subscriptionPatterns: Record<string, number> = {
          netflix: 0.9,
          ネットフリックス: 0.9,
          spotify: 0.9,
          スポティファイ: 0.9,
          'amazon prime': 0.9,
          アマゾンプライム: 0.9,
          youtube: 0.85,
          ユーチューブ: 0.85,
          disney: 0.85,
          ディズニー: 0.85,
          hulu: 0.85,
          フール: 0.85,
          dazn: 0.85,
          ダゾーン: 0.85,
          'apple music': 0.85,
          アップルミュージック: 0.85,
          'google one': 0.85,
          グーグルワン: 0.85,
          icloud: 0.85,
          アイクラウド: 0.85,
          dropbox: 0.85,
          ドロップボックス: 0.85,
          adobe: 0.85,
          アドビ: 0.85,
          microsoft: 0.8,
          マイクロソフト: 0.8,
          office: 0.8,
          オフィス: 0.8,
          aws: 0.8,
          gcp: 0.8,
          azure: 0.8,
          gym: 0.7,
          ジム: 0.7,
          fitness: 0.7,
          フィットネス: 0.7,
          月額: 0.7,
          会員: 0.6,
          定期: 0.6,
          プレミアム: 0.6,
          premium: 0.6,
          subscription: 0.8,
          サブスクリプション: 0.8,
          サブスク: 0.8,
        }

        // よく見られる定期的な支払いの金額パターン
        const commonAmounts = [
          500, 980, 1000, 1200, 1500, 1980, 2000, 2500, 2980, 3000, 3980, 4980,
          5000, 6000, 6500, 7000, 8000, 10000, 12000, 15000,
        ]

        // 初期スコア付け（パターンマッチング）
        preprocessedData.forEach((data) => {
          const content = (data.内容 || '').toLowerCase()
          let initialScore = 0
          let reason = ''

          // 有名サブスクとのパターンマッチ
          for (const [pattern, score] of Object.entries(subscriptionPatterns)) {
            if (content.includes(pattern.toLowerCase())) {
              initialScore = Math.max(initialScore, score)
              reason = `「${pattern}」を含む取引内容`
              console.log({ reason })
              break
            }
          }

          // 金額による判定（よく見られるサブスクの金額）
          const amount = Number.parseInt(
            (data.金額 || '').replace(/[^0-9]/g, ''),
            10,
          )
          if (!Number.isNaN(amount)) {
            const closestAmount = commonAmounts.find(
              (a) => Math.abs(a - amount) <= 100,
            )
            if (closestAmount && initialScore < 0.5) {
              initialScore = Math.max(initialScore, 0.5)
              reason = reason || `よく見られるサブスク金額（${amount}円）に近い`
              console.log({ reason })
            }
          }

          data.initialScore = initialScore
          data.initialReason = reason
        })

        // ステップ2: バッチに分割して処理（APIの制限を考慮）
        const batchSize = 20
        const batches = []

        for (let i = 0; i < preprocessedData.length; i += batchSize) {
          console.log({ preprocessedData })
          batches.push(preprocessedData.slice(i, i + batchSize))
        }

        // ステップ3: 各バッチに対してサブスク分析を行う
        let allResults: AnalysisResult[] = []

        for (const batch of batches) {
          const analysisPrompt = `
以下の取引データを分析し、サブスクリプションの可能性がある取引を特定してください。
各取引に対して、以下の情報を含むJSONオブジェクトの配列を返してください：
- 取引内容: 元の取引内容
- 取引金額: 金額
- 取引日: 日付
- キーワード: 取引内容から抽出した重要なキーワードの配列
- サブスク確率: 0から1の間の数値（0: 全くサブスクではない、1: 確実にサブスク）
- 理由: なぜそのスコアを付けたのか短い説明

特にサブスクリプションの特徴:
1. 定期的な支払い（毎月/毎年など）
2. デジタルサービス（Netflix、Spotify、Amazonなど）
3. 同一業者への定額支払い
4. 同じ金額の繰り返し
5. 「月額」「会員」「定期」などの単語を含む

このバッチのいくつかのトランザクションには初期スコアが設定されています:
${batch
  .map((item) =>
    item.initialScore && item.initialScore > 0
      ? `- "${item.内容}": 初期スコア ${item.initialScore}, 理由: ${item.initialReason}`
      : '',
  )
  .filter(Boolean)
  .join('\n')}

これらの初期スコアも参考にしつつ、最終的なサブスク確率と理由を決定してください。
 
 JSONデータのみを返してください。
 `

          console.log('AIにリクエストを送ります。💨', batch)
          const completion = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content:
                  'あなたは金融データ分析の専門家です。JSONのみを出力してください。',
              },
              { role: 'user', content: analysisPrompt },
              { role: 'user', content: JSON.stringify(batch) },
            ],
          })

          console.log('💰completion', JSON.stringify(completion, null, 2))

          try {
            const content = completion.choices[0].message.content || ''
            // JSONの部分を抽出
            const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s)
            if (jsonMatch) {
              const jsonContent = jsonMatch[0]
              const batchResults = JSON.parse(jsonContent) as AnalysisResult[]
              allResults = [...allResults, ...batchResults]
            }
          } catch (error) {
            console.error('JSON解析エラー:', error)
          }
        }

        // ステップ4: 同一の支払い（同じ金額・同じ業者）を見つけ、サブスク確率を更新
        const paymentGroups: Record<string, AnalysisResult[]> = {}

        // 同じ内容・金額のグループを作成
        allResults.forEach((result) => {
          const key = `${result.取引内容}-${result.取引金額}`
          if (!paymentGroups[key]) {
            paymentGroups[key] = []
          }
          paymentGroups[key].push(result)
        })

        // 繰り返し取引のサブスク確率を上げる
        Object.values(paymentGroups).forEach((group) => {
          if (group.length > 1) {
            // 2回以上同じ取引がある場合、サブスク確率を上げる
            group.forEach((result) => {
              // 元の確率を考慮しつつ、繰り返し回数に応じて確率を上げる（最大1.0）
              const repeatBonus = Math.min(0.3, group.length * 0.1)
              result.サブスク確率 = Math.min(
                1,
                result.サブスク確率 + repeatBonus,
              )

              if (repeatBonus > 0) {
                result.理由 += `、同一取引が${group.length}回検出されました`
              }
            })
          }
        })

        // 日付パターン分析
        // 同じ金額・内容の取引の日付差を分析
        const datePatternAnalysis = (group: AnalysisResult[]) => {
          if (group.length < 2) return

          // 日付をソート
          const sortedByDate = [...group].sort(
            (a, b) =>
              new Date(a.取引日).getTime() - new Date(b.取引日).getTime(),
          )

          // 日付の差を計算（日数）
          const dateDiffs: number[] = []
          for (let i = 1; i < sortedByDate.length; i++) {
            const prevDate = new Date(sortedByDate[i - 1].取引日)
            const currDate = new Date(sortedByDate[i].取引日)
            const diffTime = Math.abs(currDate.getTime() - prevDate.getTime())
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
            dateDiffs.push(diffDays)
          }

          // 月次パターンの検出（25-35日の間隔）
          const monthlyPattern = dateDiffs.some(
            (diff) => diff >= 25 && diff <= 35,
          )

          // 年次パターンの検出（360-370日の間隔）
          const yearlyPattern = dateDiffs.some(
            (diff) => diff >= 360 && diff <= 370,
          )

          if (monthlyPattern || yearlyPattern) {
            const interval = monthlyPattern ? '月次' : '年次'

            // 確率上昇とその理由を追加
            group.forEach((result) => {
              result.サブスク確率 = Math.min(1, result.サブスク確率 + 0.2)
              result.理由 += `、${interval}の支払いパターンが検出されました`
            })
          }
        }

        // 日付パターン分析の適用
        Object.values(paymentGroups).forEach((group) => {
          datePatternAnalysis(group)
        })

        // サブスク確率でソート（降順）
        return allResults.sort((a, b) => b.サブスク確率 - a.サブスク確率)
      }

      const analysisResults = await analyzeTransactions()

      // サブスク確率が0.5以上の取引のみを返す
      const subscriptionResults = analysisResults.filter(
        (result) => result.サブスク確率 >= 0.5,
      )

      console.log(
        '分析結果の一部:',
        JSON.stringify(subscriptionResults.slice(0, 3), null, 2),
      )

      return NextResponse.json({
        results: subscriptionResults,
        allTransactions: results.length,
        subscriptionCount: subscriptionResults.length,
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
