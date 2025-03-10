import { Readable } from 'node:stream'
import {
  Client,
  type WebhookEvent,
  middleware,
  validateSignature,
} from '@line/bot-sdk'
import axios, { type AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import CryptoJS from 'crypto-js'
import { type NextRequest, NextResponse } from 'next/server'

// APIルートの最大処理時間を設定
export const maxDuration = 3600 // 60分のタイムアウト

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
}

// axiosに再試行機能を追加
axiosRetry(axios, {
  retries: 3, // 再試行回数を増やす
  retryDelay: (retryCount) => {
    // 指数バックオフを使用（再試行ごとに待機時間を増加）
    return retryCount * 60000 // 1分、2分、3分の間隔で再試行
  },
  retryCondition: (error: AxiosError): boolean => {
    // ネットワークエラーのみ再試行
    // タイムアウトは再試行しない（長時間実行の場合はタイムアウトしても処理が続いている可能性）
    return (
      (axiosRetry.isNetworkOrIdempotentRequestError(error) &&
        error.code !== 'ECONNABORTED') ||
      !!(error.response && error.response.status >= 500)
    )
  },
  onRetry: (retryCount, error) => {
    console.log(`リクエスト再試行中 (${retryCount}回目):`, error.message)
  },
})

// 暗号化キー
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || config.channelSecret

// LINEクライアントの初期化
const client = new Client(config)

// 暗号化関数
function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString()
}

// 復号化関数
function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// サブスクリプション情報の型定義
interface Subscription {
  取引内容: string
  取引金額: string
  取引日: string
  キーワード: string[]
  サブスク確率: number
  理由: string
  [key: string]: any // その他のプロパティがある場合
}

// ユーザーごとの一時的なデータストレージ
interface UserData {
  transactions: {
    取引内容: string
    取引金額: string
    取引日: string
  }[]
  lastUpdated: number
}

// インメモリストレージ（実際の実装ではデータベースを使用することをお勧めします）
const userDataStore: Record<string, UserData> = {}

// データの有効期限（24時間）
const DATA_EXPIRY_MS = 24 * 60 * 60 * 1000

// サブスクリプション情報を取得するヘルパー関数
async function getSubscriptions(
  email: string,
  password: string,
): Promise<Subscription[]> {
  try {
    // URLをcloudflareではなくローカルに変更
    // タイムアウト設定を増加
    const response = await axios.post(
      '/api/finder',
      {
        email,
        password,
      },
      {
        baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
        timeout: 3000000, // 50分（3000秒）に設定
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )

    return response.data.results
  } catch (error) {
    console.error('サブスクリプション検索中にエラーが発生しました:', error)

    // エラータイプを判定して適切なメッセージを返す
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new Error(
        'リクエストがタイムアウトしました。データ量が多い場合は、期間を短くして再試行してください。',
      )
    }
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(
        `サーバーエラー: ${error.response.status} - ${error.response.statusText}`,
      )
    }
    throw error
  }
}

// CSVファイルメッセージを処理する関数
async function handleFileMessage(event: WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'file') {
    return
  }

  const replyToken = event.replyToken
  const userId = event.source.userId
  const fileId = event.message.id
  const fileName = event.message.fileName

  if (!userId) {
    console.error('ユーザーIDが取得できませんでした')
    return
  }

  // ファイル名がCSVかどうかをチェック
  if (!fileName.toLowerCase().endsWith('.csv')) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'CSVファイルのみ対応しています。拡張子が.csvのファイルを送信してください。',
    })
    return
  }

  // 古いデータをクリーンアップ
  cleanupExpiredData()

  // 処理開始のメッセージを即時応答
  await client.replyMessage(replyToken, {
    type: 'text',
    text: 'CSVファイルを解析しています。処理には時間がかかる場合があります。しばらくお待ちください...',
  })

  try {
    // LINE Content APIからファイルをダウンロード
    const fileStream = await client.getMessageContent(fileId)

    // 読み込んだデータを蓄積するためのバッファ
    const chunks: Uint8Array[] = []

    // ファイルデータをメモリに読み込む
    for await (const chunk of fileStream) {
      chunks.push(new Uint8Array(chunk))
    }

    // すべてのチャンクを結合して一つのバッファにする
    const buffer = Buffer.concat(chunks)

    // バッファをテキストに変換
    const csvText = buffer.toString('utf-8')

    // CSVの内容を解析
    const csvRows = csvText.split('\n').filter((row) => row.trim() !== '')

    // ヘッダー行を確認（必要に応じて処理）
    const header = csvRows[0].split(',').map((col) => col.trim())

    // 最低限必要なカラムがあるか確認
    const requiredColumns = ['取引内容', '取引金額', '取引日']
    const headerMap: { [key: string]: number } = {}

    // ヘッダーマッピング - 類似カラム名にも対応
    const columnMapping: { [key: string]: string[] } = {
      取引内容: [
        '取引内容',
        '内容',
        '項目',
        '摘要',
        'description',
        'item',
        'transaction',
      ],
      取引金額: [
        '取引金額',
        '金額',
        '決済金額',
        '価格',
        'amount',
        'price',
        'value',
      ],
      取引日: ['取引日', '日付', '決済日', 'date', 'transaction date'],
    }

    // 全てのヘッダーに対して、マッピング可能なものを探す
    header.forEach((col, index) => {
      const lowerCol = col.toLowerCase()

      // 各必須カラムに対して、対応する可能性のあるヘッダー名を確認
      for (const [requiredCol, possibleNames] of Object.entries(
        columnMapping,
      )) {
        if (
          possibleNames.some((name) => lowerCol.includes(name.toLowerCase()))
        ) {
          headerMap[requiredCol] = index
          break
        }
      }
    })

    // 必要なカラムが存在するかチェック
    const missingColumns = requiredColumns.filter((col) => !(col in headerMap))

    if (missingColumns.length > 0) {
      await client.pushMessage(userId, {
        type: 'text',
        text: `CSVファイルに必要なカラムがありません: ${missingColumns.join(', ')}\n必要なカラム: 取引内容, 取引金額, 取引日\n\n見つかったカラム: ${header.join(', ')}`,
      })
      return
    }

    // CSVデータから取引情報を抽出
    const transactions: {
      取引内容: string
      取引金額: string
      取引日: string
    }[] = []

    for (let i = 1; i < csvRows.length; i++) {
      // カンマが含まれる値に対応（引用符で囲まれている場合）
      const columns: string[] = []
      let inQuotes = false
      let currentValue = ''

      // 1行を文字ごとに処理してカンマと引用符を適切に扱う
      const row = csvRows[i]
      for (let j = 0; j < row.length; j++) {
        const char = row[j]

        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          columns.push(currentValue)
          currentValue = ''
        } else {
          currentValue += char
        }
      }
      columns.push(currentValue) // 最後のカラムを追加

      // カラム数が足りない行はスキップ
      if (columns.length < Math.max(...Object.values(headerMap)) + 1) continue

      try {
        // 取引金額の正規化（数字以外の文字を取り除く）
        let amount = columns[headerMap.取引金額].trim()
        // 金額の前に「-」がある場合は保持
        const isNegative = amount.startsWith('-')
        // 数字と小数点のみ残す（通貨記号や区切り文字を削除）
        amount = amount.replace(/[^\d.]/g, '')
        if (isNegative) amount = `-${amount}`

        // 日付の正規化
        let date = columns[headerMap.取引日].trim()
        // 日付フォーマットの統一化を試みる（シンプルな例）
        if (date.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
          // すでにYYYY-MM-DD形式に近いので、スラッシュをハイフンに変換
          date = date.replace(/\//g, '-')
        }

        transactions.push({
          取引内容: columns[headerMap.取引内容].trim(),
          取引金額: amount,
          取引日: date,
        })
      } catch (e) {
        console.error(
          '行の処理中にエラーが発生しました:',
          e,
          '行データ:',
          columns,
        )
        // エラーがあっても処理を続行
      }
    }

    if (transactions.length === 0) {
      await client.pushMessage(userId, {
        type: 'text',
        text: '有効な取引データがCSVファイルに見つかりませんでした。',
      })
      return
    }

    // 既存のトランザクションと統合
    const existingData = userDataStore[userId]
    let allTransactions = transactions

    if (existingData && existingData.transactions.length > 0) {
      // 既存のデータがある場合は統合
      allTransactions = [...existingData.transactions, ...transactions]

      // 重複を除外（取引内容、金額、日付が完全一致する場合）
      const uniqueTransactions = new Map()
      allTransactions.forEach((tx) => {
        const key = `${tx.取引内容}-${tx.取引金額}-${tx.取引日}`
        uniqueTransactions.set(key, tx)
      })

      allTransactions = Array.from(uniqueTransactions.values())
    }

    // ユーザーデータを更新
    userDataStore[userId] = {
      transactions: allTransactions,
      lastUpdated: Date.now(),
    }

    const totalFiles = existingData ? 2 : 1 // 簡易な実装

    // CSVファイルが正常に処理されたことを通知
    await client.pushMessage(userId, {
      type: 'text',
      text: `CSVファイル「${fileName}」の解析が完了しました。\n${transactions.length}件の取引データを抽出しました。\n${totalFiles > 1 ? `合計${allTransactions.length}件のデータが保存されています。` : ''}\n\n分析を開始するには「サブスク分析」と入力してください。別のCSVファイルを追加することもできます。`,
    })
  } catch (error) {
    console.error('CSVファイル処理中にエラーが発生しました:', error)
    await client.pushMessage(userId, {
      type: 'text',
      text: 'CSVファイルの処理中にエラーが発生しました。ファイルの形式を確認するか、しばらく経ってから再度お試しください。',
    })
  }
}

// 保存したデータから分析を実行する関数
async function analyzeUserData(userId: string) {
  const userData = userDataStore[userId]

  if (!userData || userData.transactions.length === 0) {
    return null
  }

  return await analyzeTransactions(userData.transactions)
}

// 期限切れのデータをクリーンアップ
function cleanupExpiredData() {
  const now = Date.now()

  Object.keys(userDataStore).forEach((userId) => {
    if (now - userDataStore[userId].lastUpdated > DATA_EXPIRY_MS) {
      delete userDataStore[userId]
    }
  })
}

// テキストメッセージを処理する関数
async function handleTextMessage(event: WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return
  }

  const messageText = event.message.text
  const replyToken = event.replyToken
  const userId = event.source.userId

  if (!userId) {
    console.error('ユーザーIDが取得できませんでした')
    return
  }

  // サブスク分析コマンドの処理
  if (messageText === 'サブスク分析') {
    // 保存されたデータがあるか確認
    if (
      !userDataStore[userId] ||
      userDataStore[userId].transactions.length === 0
    ) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '分析するデータがありません。CSVファイルを送信してください。',
      })
      return
    }

    await client.replyMessage(replyToken, {
      type: 'text',
      text: `${userDataStore[userId].transactions.length}件の取引データを分析しています。しばらくお待ちください...`,
    })

    try {
      // 保存されたデータから分析を実行
      const subscriptions = await analyzeUserData(userId)

      if (!subscriptions || subscriptions.length === 0) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'サブスクリプションが見つかりませんでした。取引データが存在しないか、サブスクリプションとして認識できる取引がありませんでした。',
        })
        return
      }

      // 結果を整形して送信
      const totalAmount = subscriptions.reduce((sum, sub) => {
        const amount = Number.parseFloat(sub.取引金額) || 0
        return sum + amount
      }, 0)

      // 金額順にソート
      subscriptions.sort((a, b) => {
        const amountA = Number.parseFloat(a.取引金額) || 0
        const amountB = Number.parseFloat(b.取引金額) || 0
        return amountB - amountA
      })

      // 結果をメッセージとして送信
      const summaryMessage = `${subscriptions.length}件のサブスクリプションが見つかりました。\n推定月額合計: ${totalAmount.toLocaleString()}円`

      await client.pushMessage(userId, {
        type: 'text',
        text: summaryMessage,
      })

      // サブスクリプションの詳細を複数のメッセージに分けて送信
      const MAX_ITEMS_PER_MESSAGE = 5
      for (let i = 0; i < subscriptions.length; i += MAX_ITEMS_PER_MESSAGE) {
        const chunk = subscriptions.slice(i, i + MAX_ITEMS_PER_MESSAGE)
        const detailMessage = chunk
          .map((sub, index) => {
            const itemIndex = i + index + 1
            return `${itemIndex}. ${sub.取引内容}\n金額: ${sub.取引金額}円\n確率: ${(sub.サブスク確率 * 100).toFixed(0)}%\n理由: ${sub.理由}`
          })
          .join('\n\n')

        await client.pushMessage(userId, {
          type: 'text',
          text: detailMessage,
        })
      }
    } catch (error) {
      console.error('データ分析中にエラーが発生しました:', error)
      await client.pushMessage(userId, {
        type: 'text',
        text: 'データの分析中にエラーが発生しました。もう一度お試しください。',
      })
    }
    return
  }

  // データのクリアコマンド
  if (messageText === 'データクリア') {
    if (userId in userDataStore) {
      delete userDataStore[userId]
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '保存されていたデータをすべて削除しました。',
      })
    } else {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '保存されているデータはありません。',
      })
    }
    return
  }

  // メッセージがサブスク検索コマンドかどうかを確認
  if (messageText.startsWith('サブスク検索')) {
    const parts = messageText.split(/\s+/)

    // コマンドの形式が正しいか確認
    if (parts.length !== 3) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: 'フォーマットが正しくありません。「サブスク検索 メールアドレス パスワード」の形式で入力してください。',
      })
      return
    }

    const email = parts[1]
    const password = parts[2]

    // 処理開始のメッセージを即時応答
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'サブスクリプションを検索しています。処理には最大で30分程度かかる場合があります。しばらくお待ちください...',
    })

    try {
      // 非同期でサブスク検索を実行
      const subscriptions = await getSubscriptions(email, password)

      // 結果が空の場合の処理
      if (!subscriptions || subscriptions.length === 0) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'サブスクリプションが見つかりませんでした。取引データが存在しないか、サブスクリプションとして認識できる取引がありませんでした。',
        })
        return
      }

      // 結果をpushMessageで送信
      await client.pushMessage(userId, {
        type: 'text',
        text: `${subscriptions.length}件のサブスクリプションが見つかりました:\n\n${subscriptions
          .map((s: Subscription) => {
            // APIのレスポース形式に合わせてマッピング
            const name = s.取引内容 || '不明なサービス'
            const price = s.取引金額 || '金額不明'
            const paymentDate = s.取引日 || '日付不明'
            const probability = s.サブスク確率
              ? `${Math.round(s.サブスク確率 * 100)}%`
              : '不明'
            return `・${name}: ${price}円 (${paymentDate}) [確率: ${probability}]`
          })
          .join('\n')}`,
      })
    } catch (error) {
      console.error('サブスクリプション検索中にエラーが発生しました:', error)

      let errorMessage = 'サブスクリプション検索中にエラーが発生しました。\n'

      // エラータイプに応じたメッセージ
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        errorMessage +=
          'リクエストがタイムアウトしました。データ量が多い場合は、期間を短くして再試行してください。'
      } else if (
        axios.isAxiosError(error) &&
        error.response &&
        error.response.status === 401
      ) {
        errorMessage +=
          'ログイン情報が正しくありません。メールアドレスとパスワードを確認してください。'
      } else if (axios.isAxiosError(error) && error.response) {
        errorMessage += `サーバーエラー: ${error.response.status} - ${error.response.statusText}`
      } else if (error instanceof Error) {
        errorMessage += error.message
      }

      // エラーメッセージをpushMessageで送信
      await client.pushMessage(userId, {
        type: 'text',
        text: errorMessage,
      })
    }

    return
  }
  if (messageText === 'ヘルプ') {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '以下のコマンドが利用できます：\n\n1. CSVファイルを送信: 取引データをアップロード\n2. 「サブスク分析」: アップロードしたデータからサブスクリプションを分析\n3. 「データクリア」: 保存されたデータを削除\n4. 「サブスク検索 メールアドレス パスワード」: 従来の検索方法\n\nCSVファイルには「取引内容」「取引金額」「取引日」の列が必要です。複数のCSVファイルを送ることで、データを統合して分析できます。',
    })
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'サブスクリプションを分析するにはCSVファイルを送信するか、「サブスク検索 メールアドレス パスワード」と入力してください。利用可能なコマンドの一覧は「ヘルプ」で確認できます。',
    })
  }
}

// 取引データからサブスクリプションを検出する関数
async function analyzeTransactions(
  transactions: { 取引内容: string; 取引金額: string; 取引日: string }[],
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = []

  // サブスクリプションとして検出するキーワード
  const subscriptionKeywords = [
    'Netflix',
    'Amazon Prime',
    'Spotify',
    'Apple Music',
    'YouTube',
    'Disney+',
    'Hulu',
    'U-NEXT',
    'dアニメ',
    'DAZN',
    'Kindle',
    'PlayStation',
    'Xbox',
    'Nintendo',
    '定期購入',
    '月額',
    'プレミアム',
    'サブスクリプション',
    'subscription',
    'monthly',
    'premium',
    'メンバーシップ',
    'メンバシップ',
    '会員',
    'member',
    '利用料',
    'service',
    'サービス',
    'クラブ',
    'club',
    'プラン',
    'plan',
    '定額',
  ]

  // 定期的な支払いパターンを検出するための情報
  interface TransactionPattern {
    取引内容: string
    金額: number[]
    日付: string[]
  }

  // 同じ取引内容の支払いをグループ化
  const transactionGroups: Record<string, TransactionPattern> = {}

  // 各取引を処理
  for (const transaction of transactions) {
    try {
      // 取引内容の標準化（余分な空白や記号を削除）
      const normalizedContent = transaction.取引内容.replace(/\s+/g, ' ').trim()

      // 金額を数値に変換
      const amount = Number.parseFloat(transaction.取引金額) || 0

      // 金額が0以下の場合はスキップ（入金や返金）
      if (amount <= 0) continue

      // 取引日の標準化
      const date = transaction.取引日.trim()

      // グループ化のために同じ取引内容のものをまとめる
      if (!transactionGroups[normalizedContent]) {
        transactionGroups[normalizedContent] = {
          取引内容: normalizedContent,
          金額: [],
          日付: [],
        }
      }

      transactionGroups[normalizedContent].金額.push(amount)
      transactionGroups[normalizedContent].日付.push(date)

      // キーワードマッチング
      const matchedKeywords = subscriptionKeywords.filter((keyword) =>
        normalizedContent.toLowerCase().includes(keyword.toLowerCase()),
      )

      // キーワードマッチがあればサブスクリプションとして追加
      if (matchedKeywords.length > 0) {
        const probability = Math.min(0.5 + matchedKeywords.length * 0.1, 0.99)

        // 重複チェック（同じ取引内容が既に追加されていないか）
        const exists = subscriptions.some(
          (sub) => sub.取引内容 === normalizedContent,
        )

        if (!exists) {
          subscriptions.push({
            取引内容: normalizedContent,
            取引金額: amount.toString(),
            取引日: date,
            キーワード: matchedKeywords,
            サブスク確率: probability,
            理由: `キーワード「${matchedKeywords.join('、')}」に一致しました。`,
          })
        }
      }
    } catch (e) {
      console.error('取引の分析中にエラーが発生しました:', e)
      // エラーがあっても処理を続行
    }
  }

  // 定期的な支払いパターンを検出
  for (const [content, pattern] of Object.entries(transactionGroups)) {
    // 既にサブスクリプションとして追加されていれば処理をスキップ
    if (subscriptions.some((sub) => sub.取引内容 === content)) {
      continue
    }

    // 支払い回数
    const count = pattern.金額.length

    // 少なくとも2回以上の支払いがある場合のみパターン分析
    if (count >= 2) {
      // 金額の一貫性をチェック（同じ金額が繰り返される場合）
      const uniqueAmounts = new Set(pattern.金額)
      const amountConsistency =
        uniqueAmounts.size === 1 ? 1 : 1 - uniqueAmounts.size / count

      // 平均金額
      const avgAmount = pattern.金額.reduce((sum, amt) => sum + amt, 0) / count

      // 金額が一貫していて、平均額が3,000円以下の場合、サブスクリプションの可能性が高い
      if (amountConsistency > 0.7 && avgAmount <= 3000 && avgAmount > 0) {
        subscriptions.push({
          取引内容: content,
          取引金額: avgAmount.toString(),
          取引日: pattern.日付[0], // 最初の取引日
          キーワード: [],
          サブスク確率: 0.5 + amountConsistency * 0.3,
          理由: `同じ金額(${avgAmount.toLocaleString()}円)で${count}回の支払いがあります。`,
        })
      }
    } else {
      // 1回だけの支払いの場合でも、金額が特定の範囲内ならサブスクの可能性あり
      const amount = pattern.金額[0]
      if (amount > 0 && amount <= 3000) {
        subscriptions.push({
          取引内容: content,
          取引金額: amount.toString(),
          取引日: pattern.日付[0],
          キーワード: [],
          サブスク確率: 0.3,
          理由: '少額の支払いがあります。定期的な支払いの可能性があります。',
        })
      }
    }
  }

  return subscriptions
}

// Webhookハンドラー
export async function POST(request: NextRequest) {
  try {
    // リクエストボディを取得
    const body = await request.text()
    const signature = request.headers.get('x-line-signature')

    // 署名検証
    if (
      !signature ||
      !validateSignature(body, config.channelSecret, signature)
    ) {
      return NextResponse.json({ error: '署名が無効です' }, { status: 401 })
    }

    // イベントをパース
    const events: WebhookEvent[] = JSON.parse(body).events

    // 各イベントを処理
    await Promise.all(
      events.map(async (event) => {
        try {
          // メッセージイベントの場合
          if (event.type === 'message') {
            if (event.message.type === 'text') {
              await handleTextMessage(event)
            } else if (event.message.type === 'file') {
              await handleFileMessage(event)
            }
          }
          // 他のイベントタイプも必要に応じて追加
        } catch (err) {
          console.error('イベント処理中にエラーが発生しました:', err)
        }
      }),
    )

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Webhookハンドラーでエラーが発生しました:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 },
    )
  }
}

// LINE Platformからの認証チェック用
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'ok' })
}
