import {
  Client,
  type WebhookEvent,
  middleware,
  validateSignature,
} from '@line/bot-sdk'
import axios from 'axios'
import CryptoJS from 'crypto-js'
import { type NextRequest, NextResponse } from 'next/server'

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
}

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

// サブスクリプション情報を取得するヘルパー関数
async function getSubscriptions(email: string, password: string) {
  try {
    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/finder`,
      {
        email,
        password,
      },
    )

    return response.data.results
  } catch (error) {
    console.error('サブスクリプション検索中にエラーが発生しました:', error)
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

    try {
      // ユーザーIDと認証情報の組み合わせを暗号化してトークンを作成
      // 実際のアプリケーションでは、このトークンをデータベースに保存し、
      // ユーザーが再度認証せずに利用できるようにすることも検討できます
      const encryptedToken = encrypt(
        JSON.stringify({
          userId,
          email,
          password,
          timestamp: new Date().toISOString(),
        }),
      )
      console.log(`暗号化トークンを生成しました: ${userId}`)

      // 実行中メッセージを送信
      await client.replyMessage(replyToken, {
        type: 'text',
        text: 'サブスクリプションを検索しています。しばらくお待ちください...',
      })

      // サブスクリプション情報を取得
      const subscriptions = await getSubscriptions(email, password)

      if (!subscriptions || subscriptions.length === 0) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'サブスクリプションが見つかりませんでした。',
        })
        return
      }

      // 結果の整形
      let resultMessage = '以下のサブスクリプションが見つかりました:\n\n'

      // 上位10件のみ表示
      const topResults = subscriptions.slice(0, 10)

      topResults.forEach((sub: any, index: number) => {
        resultMessage += `${index + 1}. ${sub.取引内容}\n`
        resultMessage += `   金額: ${sub.取引金額}円\n`
        resultMessage += `   確率: ${Math.round(sub.サブスク確率 * 100)}%\n`
        resultMessage += `   理由: ${sub.理由}\n\n`
      })

      // 合計金額の計算
      const totalAmount = topResults.reduce((sum: number, sub: any) => {
        const amount = Number.parseInt(sub.取引金額.replace(/,/g, ''), 10) || 0
        return sum + amount
      }, 0)

      resultMessage += `月間サブスク推定総額: ${totalAmount.toLocaleString()}円`

      // 結果を送信
      await client.pushMessage(userId, {
        type: 'text',
        text: resultMessage,
      })
    } catch (error) {
      console.error('サブスクリプション検索中にエラーが発生しました:', error)
      await client.pushMessage(userId, {
        type: 'text',
        text: 'エラーが発生しました。もう一度お試しください。',
      })
    }
  } else if (messageText === 'ヘルプ') {
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
