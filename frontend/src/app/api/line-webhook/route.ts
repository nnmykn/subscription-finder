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
import { Readable } from 'node:stream'

// APIルートの最大処理時間を設定
export const maxDuration = 3600; // 60分のタイムアウト

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
      (axiosRetry.isNetworkOrIdempotentRequestError(error) && error.code !== 'ECONNABORTED') ||
      !!(error.response && error.response.status >= 500)
    )
  },
  onRetry: (retryCount, error) => {
    console.log(`リクエスト再試行中 (${retryCount}回目):`, error.message)
  }
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
        text: `${subscriptions.length}件のサブスクリプションが見つかりました:\n\n${subscriptions.map((s: Subscription) => {
          // APIのレスポース形式に合わせてマッピング
          const name = s.取引内容 || '不明なサービス'
          const price = s.取引金額 || '金額不明'
          const paymentDate = s.取引日 || '日付不明'
          const probability = s.サブスク確率 ? `${Math.round(s.サブスク確率 * 100)}%` : '不明'
          return `・${name}: ${price}円 (${paymentDate}) [確率: ${probability}]`
        }).join('\n')}`,
      })
    } catch (error) {
      console.error('サブスクリプション検索中にエラーが発生しました:', error)

      let errorMessage = 'サブスクリプション検索中にエラーが発生しました。\n'

      // エラータイプに応じたメッセージ
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        errorMessage +=
          'リクエストがタイムアウトしました。データ量が多い場合は、期間を短くして再試行してください。'
      } else if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
        errorMessage += 'ログイン情報が正しくありません。メールアドレスとパスワードを確認してください。'
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
    // ヘルプメッセージ
    await client.replyMessage(replyToken, {
      type: 'text',
      text: `サブスクリプション検索ボットの使い方:

1. サブスクリプションを検索するには次のコマンドを入力:
   サブスク検索 メールアドレス パスワード
   ※メールアドレスとパスワードはMoneyForwardのログイン情報です

2. このボットはMoneyForwardのデータを分析し、サブスクリプションの可能性が高い取引を表示します。

3. セキュリティについて:
   - 認証情報は暗号化して処理されます
   - プライベートなチャットでのみ使用してください`,
    })
  } else {
    // デフォルトメッセージ
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'サブスクリプションを検索するには「サブスク検索 メールアドレス パスワード」と入力してください。詳しい情報は「ヘルプ」と入力してください。',
    })
  }
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
            await handleTextMessage(event)
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
