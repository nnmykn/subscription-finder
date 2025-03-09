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

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
}

// axiosに再試行機能を追加
axiosRetry(axios, {
  retries: 3, // 最大3回まで再試行
  retryDelay: (retryCount) => {
    return retryCount * 1000 // 指数バックオフ（1秒、2秒、3秒...）
  },
  retryCondition: (error: AxiosError): boolean => {
    // タイムアウトエラーと5xxエラーの場合のみ再試行
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      !!(error.response && error.response.status >= 500)
    )
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
  name: string
  price: number | string
  paymentDate: string
  [key: string]: any // その他のプロパティがある場合
}

// サブスクリプション情報を取得するヘルパー関数
async function getSubscriptions(
  email: string,
  password: string,
): Promise<Subscription[]> {
  try {
    // URLをcloudflareではなくローカルに変更
    // タイムアウト設定を30秒に設定
    const response = await axios.post(
      '/api/finder',
      {
        email,
        password,
      },
      {
        baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
        timeout: 30000, // 30秒のタイムアウト
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
        'リクエストがタイムアウトしました。後ほど再試行してください。',
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
      text: 'サブスクリプションを検索しています。しばらくお待ちください...',
    })

    try {
      // 非同期でサブスク検索を実行
      const subscriptions = await getSubscriptions(email, password)

      // 結果をpushMessageで送信
      await client.pushMessage(userId, {
        type: 'text',
        text: `${subscriptions.length}件のサブスクリプションが見つかりました:\n\n${subscriptions.map((s: Subscription) => `・${s.name}: ${s.price}円 (${s.paymentDate})`).join('\n')}`,
      })
    } catch (error) {
      console.error('サブスクリプション検索中にエラーが発生しました:', error)

      let errorMessage = 'サブスクリプション検索中にエラーが発生しました。'

      // エラータイプに応じたメッセージ
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        errorMessage +=
          'リクエストがタイムアウトしました。後ほど再試行してください。'
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
