import { Readable } from 'node:stream';
import {
  Client,
  type WebhookEvent,
  middleware,
  validateSignature,
} from '@line/bot-sdk';
import axios, { type AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import CryptoJS from 'crypto-js';
import { type NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';

// APIルートの最大処理時間を設定
export const maxDuration = 3600; // 60分のタイムアウト

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

// axiosに再試行機能を追加
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 60000; // 1分、2分、3分の間隔で再試行
  },
  retryCondition: (error: AxiosError): boolean => {
    return (
        (axiosRetry.isNetworkOrIdempotentRequestError(error) &&
            error.code !== 'ECONNABORTED') ||
        !!(error.response && error.response.status >= 500)
    );
  },
  onRetry: (retryCount, error) => {
    console.log(`リクエスト再試行中 (${retryCount}回目):`, error.message);
  },
});

// 暗号化キー
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || config.channelSecret;

// LINEクライアントの初期化
const client = new Client(config);

// 暗号化関数
function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

// 復号化関数
function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// サブスクリプション情報の型定義
interface Subscription {
  取引内容: string;
  取引金額: string;
  取引日: string;
  キーワード: string[];
  サブスク確率: number;
  理由: string;
  グループID?: string;
  サービス名?: string;
  最終更新日?: string;
  サブスクID?: string;
  [key: string]: any;
}

// ユーザーごとの一時的なデータストレージ
interface UserData {
  transactions: {
    取引内容: string;
    取引金額: string;
    取引日: string;
    [key: string]: any;
  }[];
  lastUpdated: number;
  metadata?: {
    totalAmount?: number;
    fileCount?: number;
    lastFileName?: string;
  };
}

// インメモリストレージ（実際の実装ではデータベースを使用することをお勧めします）
const userDataStore: Record<string, UserData> = {};

// データの有効期限（24時間）
const DATA_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * サブスクリプション検出用のサービスデータベース
 * - 名前：サービス名の正規表現パターン
 * - スコア：そのサービスがサブスクである確率
 * - カテゴリ：サービスのカテゴリ
 * - 期間：通常の支払い周期（月次/年次）
 * - 平均金額：一般的な料金範囲
 */
const SUBSCRIPTION_SERVICES = [
  // 動画/音楽ストリーミング
  {
    name: /netflix|ネットフリックス/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [990, 1980]
  },
  {
    name: /spotify|スポティファイ/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [980, 1280]
  },
  {
    name: /amazon\s*prime|プライム.*ビデオ|prime\s*video/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [500, 600]
  },
  {
    name: /youtube\s*premium|ユーチューブ.*プレミアム/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [1180, 2280]
  },
  {
    name: /disney\+|ディズニープラス/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [990, 1320]
  },
  {
    name: /hulu|フールー/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [1026, 1500]
  },
  {
    name: /dazn/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [980, 3700]
  },
  {
    name: /apple\s*music|アップルミュージック/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [980, 1480]
  },
  {
    name: /u-?next|ユーネクスト/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [2189, 2189]
  },
  {
    name: /abema\s*premium|アベマ.*プレミアム/i,
    score: 0.95,
    category: '動画・音楽',
    period: 'monthly',
    avgPrice: [960, 960]
  },

  // ソフトウェア/クラウド
  {
    name: /microsoft\s*365|office\s*365/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [1284, 1284]
  },
  {
    name: /adobe|アドビ|creative\s*cloud/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [2380, 6580]
  },
  {
    name: /google\s*one/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [250, 2500]
  },
  {
    name: /icloud\+|アイクラウド/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [130, 1300]
  },
  {
    name: /dropbox/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [1200, 2400]
  },
  {
    name: /evernote/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [500, 1500]
  },
  {
    name: /notion/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [500, 2000]
  },

  // AI/開発サービス
  {
    name: /chatgpt|openai/i,
    score: 0.95,
    category: 'AI・開発サービス',
    period: 'monthly',
    avgPrice: [2000, 4000]
  },
  {
    name: /github/i,
    score: 0.95,
    category: 'AI・開発サービス',
    period: 'monthly',
    avgPrice: [500, 2000]
  },
  {
    name: /gitlab/i,
    score: 0.95,
    category: 'AI・開発サービス',
    period: 'monthly',
    avgPrice: [1500, 3000]
  },
  {
    name: /claude|anthropic/i,
    score: 0.95,
    category: 'AI・開発サービス',
    period: 'monthly',
    avgPrice: [2000, 3500]
  },

  // 通信/インターネット
  {
    name: /nuro/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [5200, 5200]
  },
  {
    name: /ソフトバンク|softbank/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [3000, 10000]
  },
  {
    name: /docomo|ドコモ/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [3000, 10000]
  },
  {
    name: /au|エーユー/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [3000, 10000]
  },
  {
    name: /楽天モバイル|rakuten\s*mobile/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [3000, 5000]
  },
  {
    name: /wimax|ワイマックス/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [3000, 5000]
  },
  {
    name: /光回線|光ファイバー|インターネット回線/i,
    score: 0.9,
    category: '通信・インターネット',
    period: 'monthly',
    avgPrice: [4000, 6000]
  },

  // メディア/情報
  {
    name: /日経|nikkei/i,
    score: 0.9,
    category: 'メディア・情報',
    period: 'monthly',
    avgPrice: [2000, 4000]
  },
  {
    name: /朝日新聞|asahi/i,
    score: 0.9,
    category: 'メディア・情報',
    period: 'monthly',
    avgPrice: [2000, 4000]
  },
  {
    name: /読売新聞|yomiuri/i,
    score: 0.9,
    category: 'メディア・情報',
    period: 'monthly',
    avgPrice: [2000, 4000]
  },
  {
    name: /kindle\s*unlimited/i,
    score: 0.9,
    category: 'メディア・情報',
    period: 'monthly',
    avgPrice: [980, 980]
  },
  {
    name: /audible|オーディブル/i,
    score: 0.9,
    category: 'メディア・情報',
    period: 'monthly',
    avgPrice: [1500, 1500]
  },

  // その他のサブスク
  {
    name: /1password|ワンパスワード/i,
    score: 0.95,
    category: 'ソフトウェア・クラウド',
    period: 'monthly',
    avgPrice: [500, 1000]
  },
  {
    name: /ドメイン|domain|お名前\.com|ムームー/i,
    score: 0.8,
    category: 'ソフトウェア・クラウド',
    period: 'yearly',
    avgPrice: [1000, 5000]
  }
];

// サブスク可能性を示すキーワード
const SUBSCRIPTION_INDICATORS = [
  { indicator: '月額', score: 0.8 },
  { indicator: '年額', score: 0.8 },
  { indicator: '自動更新', score: 0.8 },
  { indicator: '定期', score: 0.7 },
  { indicator: 'プレミアム', score: 0.7 },
  { indicator: 'premium', score: 0.7 },
  { indicator: 'メンバーシップ', score: 0.7 },
  { indicator: 'メンバシップ', score: 0.7 },
  { indicator: '会員', score: 0.6 },
  { indicator: 'member', score: 0.6 },
  { indicator: '利用料', score: 0.6 },
  { indicator: 'service', score: 0.5 },
  { indicator: 'サービス', score: 0.5 },
  { indicator: 'クラブ', score: 0.5 },
  { indicator: 'club', score: 0.5 },
  { indicator: 'プラン', score: 0.6 },
  { indicator: 'plan', score: 0.6 },
  { indicator: '定額', score: 0.7 },
  { indicator: 'サブスク', score: 0.9 },
  { indicator: 'subscription', score: 0.9 }
];

// 典型的なサブスクではない取引を示すキーワード
const NON_SUBSCRIPTION_KEYWORDS = [
  'チャージ', 'ポイント', '振込', '給与', '給料', '割引',
  'atm', '出金', '入金', 'キャッシュバック', '現金'
];

// Amazon注文を判別するためのパターン
const AMAZON_ORDER_PATTERNS = [
  /Amazon.co.jp/i,
  /amazon.com/i,
  /amazonマーケットプレイス/i,
  /amazon marketplace/i
];

// よくあるサブスク月額価格帯
const COMMON_SUBSCRIPTION_PRICES = [
  298, 299, 300, 350, 380, 398, 399, 400, 480, 490, 498, 499, 500, 550,
  580, 598, 599, 600, 700, 800, 900, 980, 990, 998, 999, 1000, 1100,
  1200, 1380, 1480, 1500, 1650, 1800, 1950, 1980, 2000, 2200, 2380,
  2500, 2980, 3000, 3980, 4000, 4980, 5000, 5980, 6000, 6980, 7000,
  7980, 8000, 8980, 9000, 9800, 9980, 10000
];

// サブスクリプション情報を取得するヘルパー関数
async function getSubscriptions(
    email: string,
    password: string,
): Promise<Subscription[]> {
  try {
    // URLをcloudflareではなくローカルに変更
    // タイムアウト設定を短縮
    const response = await axios.post(
        '/api/finder',
        {
          email,
          password,
        },
        {
          baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
          timeout: 3000000, // 50分に設定
          headers: {
            'Content-Type': 'application/json',
          },
        },
    );

    return response.data.results;
  } catch (error) {
    console.error('サブスクリプション検索中にエラーが発生しました:', error);

    // エラータイプを判定して適切なメッセージを返す
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      throw new Error(
          'リクエストがタイムアウトしました。データ量が多い場合は、期間を短くして再試行してください。',
      );
    }
    if (axios.isAxiosError(error) && error.response) {
      // エラーレスポンスの詳細ログ
      console.error('API応答詳細:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      });

      throw new Error(
          `サーバーエラー: ${error.response.status} - ${error.response.statusText}`,
      );
    }
    throw new Error(
        'サブスクリプションの検索中にエラーが発生しました。しばらく経ってから再試行してください。',
    );
  }
}

/**
 * サブスクリプションを見やすい形式にフォーマットする関数
 * @param subscriptions サブスクリプションの配列
 * @param options 表示オプション
 * @returns フォーマットされたメッセージの配列
 */
function formatSubscriptionsForDisplay(
    subscriptions: Subscription[],
    options: { detailed?: boolean; categorySort?: boolean } = {}
): string[] {
  // 結果が空の場合は早期リターン
  if (!subscriptions || subscriptions.length === 0) {
    return ['サブスクリプションが見つかりませんでした。'];
  }

  // オプションの設定
  const detailed = options.detailed || false;
  const categorySort = options.categorySort || false;

  // サブスクリプションのカテゴリ定義
  const categories: { [key: string]: string[] } = {
    '動画・音楽': [
      'netflix', 'ネットフリックス', 'spotify', 'スポティファイ',
      'amazon prime', 'prime video', 'プライムビデオ', 'youtube',
      'disney', 'ディズニー', 'hulu', 'フールー', 'dazn', 'u-next', 'abema'
    ],
    'ソフトウェア・クラウド': [
      'microsoft', 'office', 'adobe', 'creative cloud', 'google one',
      'icloud', 'dropbox', 'evernote', 'notion'
    ],
    'AI・開発サービス': [
      'chatgpt', 'openai', 'github', 'gitlab', 'claude', 'anthropic'
    ],
    '通信・インターネット': [
      'nuro', 'ソフトバンク', 'docomo', 'ドコモ', 'au', '楽天モバイル',
      'wimax', 'インターネット', '光回線', 'プロバイダ'
    ],
    'メディア・情報': [
      '日経', '新聞', 'kindle', 'audible'
    ]
  };

  // 同じ名前のサブスクリプションを統合する
  interface ConsolidatedSubscription {
    取引内容: string;
    平均金額: number;
    最新日付: string;
    取引回数: number;
    サブスク確率: number;
    理由: string;
    キーワード: string[];
    グループID?: string;
    サービス名: string; // カテゴリ分類用
  }

  // サブスクリプションの名前を正規化するヘルパー関数
  const normalizeServiceName = (name: string): string => {
    // 特殊文字や余分な空白を削除し、小文字に変換
    return name.toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
  };

  // 特定のサービスパターンを認識して統一名称にマッピングするヘルパー関数
  const identifyService = (name: string): string => {
    const normalizedName = normalizeServiceName(name);

    // サービス名の統一パターン
    const servicePatterns = [
      { pattern: /netflix|ネットフリックス/i, name: 'Netflix' },
      { pattern: /spotify|スポティファイ/i, name: 'Spotify' },
      { pattern: /amazon\s*prime|プライム.*ビデオ|prime\s*video/i, name: 'Amazon Prime' },
      { pattern: /youtube\s*premium|ユーチューブ.*プレミアム/i, name: 'YouTube Premium' },
      { pattern: /disney\+|ディズニープラス/i, name: 'Disney+' },
      { pattern: /hulu|フールー/i, name: 'Hulu' },
      { pattern: /u-?next|ユーネクスト/i, name: 'U-NEXT' },
      { pattern: /kindle\s*unlimited/i, name: 'Kindle Unlimited' },
      { pattern: /adobe|アドビ/i, name: 'Adobe' },
      { pattern: /microsoft|office\s*365/i, name: 'Microsoft 365' },
      { pattern: /google|gsuite/i, name: 'Google' },
      { pattern: /chatgpt|openai/i, name: 'OpenAI/ChatGPT' },
      { pattern: /claude|anthropic/i, name: 'Claude' },
      { pattern: /docomo|ドコモ/i, name: 'Docomo' },
      { pattern: /softbank|ソフトバンク/i, name: 'SoftBank' },
      { pattern: /rakuten|楽天/i, name: 'Rakuten' },
      { pattern: /apple\s*music|アップル.*ミュージック/i, name: 'Apple Music' },
      { pattern: /1password/i, name: '1Password' },
      { pattern: /お名前\.com/i, name: 'お名前.com' },
      { pattern: /ムームードメイン|ムーム[ーム]ドメイン/i, name: 'ムームードメイン' },
    ];

    for (const { pattern, name } of servicePatterns) {
      if (pattern.test(normalizedName)) {
        return name;
      }
    }

    // マッチするパターンがなければ元の名前を返す
    return name;
  };

  // サブスクリプションを名前ごとに統合
  const consolidatedMap = new Map<string, ConsolidatedSubscription>();

  subscriptions.forEach(sub => {
    // 金額を数値に変換
    const amount = Math.abs(parseFloat(sub.取引金額) || 0);

    // サービス名を識別
    const serviceName = identifyService(sub.取引内容);
    const key = normalizeServiceName(serviceName);

    if (consolidatedMap.has(key)) {
      // 既存のエントリーを更新
      const existing = consolidatedMap.get(key)!;

      // 合計金額を更新
      const totalAmount = existing.平均金額 * existing.取引回数 + amount;
      const newCount = existing.取引回数 + 1;

      // 日付を比較して最新の日付を使用
      const existingDate = new Date(existing.最新日付 || '1970-01-01');
      const currentDate = new Date(sub.取引日 || '1970-01-01');
      const latestDate = currentDate > existingDate ? sub.取引日 : existing.最新日付;

      // 確率は最大値を使用
      const maxProbability = Math.max(existing.サブスク確率, sub.サブスク確率);

      // 更新
      consolidatedMap.set(key, {
        ...existing,
        平均金額: totalAmount / newCount,
        最新日付: latestDate,
        取引回数: newCount,
        サブスク確率: maxProbability,
        // 理由は最高確率のものを使用
        理由: maxProbability === sub.サブスク確率 ? sub.理由 : existing.理由
      });
    } else {
      // 新しいエントリーを作成
      consolidatedMap.set(key, {
        取引内容: serviceName, // 統一されたサービス名を使用
        平均金額: amount,
        最新日付: sub.取引日 || '',
        取引回数: 1,
        サブスク確率: sub.サブスク確率,
        理由: sub.理由,
        キーワード: sub.キーワード || [],
        グループID: sub.グループID,
        サービス名: serviceName
      });
    }
  });

  // 統合したサブスクリプションの配列を取得
  const consolidatedSubs = Array.from(consolidatedMap.values());

  // サブスクリプションをカテゴリごとに分類
  const categorizedSubs: { [key: string]: ConsolidatedSubscription[] } = {};
  const otherSubs: ConsolidatedSubscription[] = [];

  // 各サブスクリプションをカテゴリに割り当て
  consolidatedSubs.forEach(sub => {
    let foundCategory = false;
    const content = sub.取引内容.toLowerCase();

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => content.includes(keyword))) {
        if (!categorizedSubs[category]) {
          categorizedSubs[category] = [];
        }
        categorizedSubs[category].push(sub);
        foundCategory = true;
        break;
      }
    }

    if (!foundCategory) {
      otherSubs.push(sub);
    }
  });

  // フォーマット用のメッセージ配列
  const messages: string[] = [];

  // サマリーを作成
  const totalAmount = consolidatedSubs.reduce((sum, sub) => sum + sub.平均金額, 0);

  // 各カテゴリの合計金額を計算
  const categorySummaries: string[] = [];
  if (categorySort) {
    Object.entries(categorizedSubs).forEach(([category, subs]) => {
      const categoryTotal = subs.reduce((sum, sub) => sum + sub.平均金額, 0);
      categorySummaries.push(`${category}: ${categoryTotal.toLocaleString()}円`);
    });

    // その他カテゴリの合計金額
    const otherTotal = otherSubs.reduce((sum, sub) => sum + sub.平均金額, 0);
    if (otherTotal > 0) {
      categorySummaries.push(`その他: ${otherTotal.toLocaleString()}円`);
    }
  }

  // サマリーメッセージ
  let summaryMessage = `🔍 ${consolidatedSubs.length}件のサブスクリプションが見つかりました\n`;
  summaryMessage += `💰 推定月額合計: ${totalAmount.toLocaleString()}円\n`;

  if (categorySummaries.length > 0) {
    summaryMessage += `\n📊 カテゴリ別合計:\n${categorySummaries.join('\n')}`;
  }

  messages.push(summaryMessage);

  // 詳細リストの作成
  const formatSubscription = (sub: ConsolidatedSubscription, index: number): string => {
    const amountStr = `${Math.round(sub.平均金額).toLocaleString()}円`;
    const dateStr = sub.最新日付 ? `(${sub.最新日付})` : '';
    const probability = `${Math.round(sub.サブスク確率 * 100)}%`;
    const countStr = sub.取引回数 > 1 ? `[${sub.取引回数}回検出]` : '';

    if (detailed) {
      return `${index}. ${sub.取引内容}\n   💰 月額: ${amountStr} ${countStr}\n   📅 最新日付: ${dateStr}\n   ⭐ 確率: ${probability}\n   💡 理由: ${sub.理由}`;
    } else {
      return `${index}. ${sub.取引内容}\n   💰 ${amountStr} ${dateStr} ${countStr}\n   ⭐${probability}`;
    }
  };

  // カテゴリソートが有効の場合はカテゴリごとに表示
  if (categorySort) {
    let itemIndex = 1;

    Object.entries(categorizedSubs).forEach(([category, subs]) => {
      if (subs.length === 0) return;

      // 金額順にソート
      subs.sort((a, b) => b.平均金額 - a.平均金額);

      const categoryItems = [`\n📱 ${category} (${subs.length}件)`];

      subs.forEach(sub => {
        categoryItems.push(formatSubscription(sub, itemIndex++));
      });

      messages.push(categoryItems.join('\n'));
    });

    // その他カテゴリがあれば表示
    if (otherSubs.length > 0) {
      otherSubs.sort((a, b) => b.平均金額 - a.平均金額);

      const otherItems = [`\n🔄 その他 (${otherSubs.length}件)`];

      otherSubs.forEach(sub => {
        otherItems.push(formatSubscription(sub, itemIndex++));
      });

      messages.push(otherItems.join('\n'));
    }
  } else {
    // 単純に金額順でソート
    const sortedSubs = [...consolidatedSubs].sort((a, b) => b.平均金額 - a.平均金額);

    // リストを複数メッセージに分割するための処理
    const MAX_ITEMS_PER_MESSAGE = 10; // 統合後は項目が減るので少し増やせる
    for (let i = 0; i < sortedSubs.length; i += MAX_ITEMS_PER_MESSAGE) {
      const chunk = sortedSubs.slice(i, i + MAX_ITEMS_PER_MESSAGE);
      const detailMessage = chunk.map((sub, idx) => formatSubscription(sub, i + idx + 1)).join('\n\n');
      messages.push(detailMessage);
    }
  }

  return messages;
}

/**
 * CSVファイルメッセージを処理する関数
 * @param event LINEのWebhookイベント
 */
async function handleFileMessage(event: WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'file') {
    return;
  }

  const replyToken = event.replyToken;
  const userId = event.source.userId;
  const fileId = event.message.id;
  const fileName = event.message.fileName;

  if (!userId) {
    console.error('ユーザーIDが取得できませんでした');
    return;
  }

  // ファイル名がCSVかどうかをチェック
  if (!fileName.toLowerCase().endsWith('.csv')) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'CSVファイルのみ対応しています。拡張子が.csvのファイルを送信してください。',
    });
    return;
  }

  // 古いデータをクリーンアップ
  cleanupExpiredData();

  // 処理開始のメッセージを即時応答
  await client.replyMessage(replyToken, {
    type: 'text',
    text: 'CSVファイルを解析しています。処理には時間がかかる場合があります。しばらくお待ちください...',
  });

  try {
    // LINE Content APIからファイルをダウンロード
    const fileStream = await client.getMessageContent(fileId);

    // 読み込んだデータを蓄積するためのバッファ
    const chunks: Uint8Array[] = [];

    // ファイルデータをメモリに読み込む
    for await (const chunk of fileStream) {
      chunks.push(new Uint8Array(chunk));
    }

    // すべてのチャンクを結合して一つのバッファにする
    const buffer = Buffer.concat(chunks);

    // 文字コードを判定して適切にデコード
    let csvText = '';
    try {
      // まずUTF-8でデコード試行
      csvText = buffer.toString('utf-8');
      // BOMを削除
      if (csvText.charCodeAt(0) === 0xFEFF) {
        csvText = csvText.substring(1);
      }
    } catch (e) {
      // UTF-8で失敗したら、Shift-JISと仮定
      console.log('UTF-8デコードに失敗、Shift-JISで試行');
      const iconv = await import('iconv-lite');
      csvText = iconv.default.decode(buffer, 'Shift_JIS');
    }

    // CSVパース処理を改善
    let parsedData: any[] = [];
    let headerMap: { [key: string]: string } = {};

    try {
      // Papaparseでパース
      const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => {
          // ヘッダーマッピング - 類似カラム名にも対応
          const columnMapping: { [key: string]: string[] } = {
            取引内容: [
              '取引内容', '内容', '項目', '摘要', 'description', 'item',
              'transaction', '明細', '支払内容', '摘要', '利用店名',
              'merchant', 'store', 'shop', '店舗名', '利用先', '店名'
            ],
            取引金額: [
              '取引金額', '金額', '決済金額', '価格', 'amount', 'price',
              'value', '利用金額', '支払金額', '支払額', '引落金額',
              'charge', 'payment'
            ],
            取引日: [
              '取引日', '日付', '決済日', 'date', 'transaction date',
              '利用日', '支払日', '支払日付', 'transaction_date',
              'payment_date', '引落日', '購入日'
            ],
          };

          const lowerHeader = header.toLowerCase().trim();

          // 各必須カラムに対して、対応する可能性のあるヘッダー名を確認
          for (const [requiredCol, possibleNames] of Object.entries(columnMapping)) {
            if (possibleNames.some(name => lowerHeader.includes(name.toLowerCase()))) {
              headerMap[lowerHeader] = requiredCol;
              return requiredCol;
            }
          }

          return header;
        }
      });

      parsedData = result.data;
      console.log(`CSVパース成功: ${parsedData.length}行`);
    } catch (parseError) {
      console.error('Papaparse処理失敗:', parseError);

      // 手動でCSVをパースする
      const csvRows = csvText.split('\n').filter((row) => row.trim() !== '');
      if (csvRows.length === 0) {
        throw new Error('CSVファイルが空です');
      }

      // ヘッダー行を取得
      const header = csvRows[0].split(',').map((col) => col.trim());

      // ヘッダーマッピング作成
      const columnMapping: { [key: string]: string[] } = {
        取引内容: [
          '取引内容', '内容', '項目', '摘要', 'description', 'item',
          'transaction', '明細', '支払内容'
        ],
        取引金額: [
          '取引金額', '金額', '決済金額', '価格', 'amount', 'price',
          'value', '利用金額', '支払金額', '支払額'
        ],
        取引日: [
          '取引日', '日付', '決済日', 'date', 'transaction date',
          '利用日', '支払日', '支払日付'
        ],
      };

      const headerIndexMap: { [key: string]: number } = {};

      // ヘッダーのインデックスを特定
      header.forEach((col, index) => {
        const lowerCol = col.toLowerCase().trim();

        for (const [requiredCol, possibleNames] of Object.entries(columnMapping)) {
          if (possibleNames.some(name => lowerCol.includes(name.toLowerCase()))) {
            headerIndexMap[requiredCol] = index;
            break;
          }
        }
      });

      // データ行を処理
      for (let i = 1; i < csvRows.length; i++) {
        const row = csvRows[i];
        if (!row.trim()) continue;

        // カンマ区切りの処理（引用符対応）
        const parseCSVRow = (rowText: string): string[] => {
          const result: string[] = [];
          let inQuotes = false;
          let currentValue = '';

          for (let j = 0; j < rowText.length; j++) {
            const char = rowText[j];

            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              result.push(currentValue);
              currentValue = '';
            } else {
              currentValue += char;
            }
          }

          result.push(currentValue); // 最後の値を追加
          return result;
        };

        const values = parseCSVRow(row);

        // 必要なデータが揃っているか確認
        if (
            headerIndexMap.取引内容 !== undefined &&
            headerIndexMap.取引金額 !== undefined &&
            headerIndexMap.取引日 !== undefined &&
            values.length > Math.max(...Object.values(headerIndexMap))
        ) {
          const rowData: any = {};
          rowData.取引内容 = values[headerIndexMap.取引内容].trim();
          rowData.取引金額 = values[headerIndexMap.取引金額].trim();
          rowData.取引日 = values[headerIndexMap.取引日].trim();

          parsedData.push(rowData);
        }
      }
    }

    // 必要なカラムが揃っているか確認
    const requiredColumns = ['取引内容', '取引金額', '取引日'];
    const missingColumns = requiredColumns.filter(col =>
        !parsedData.length || !Object.keys(parsedData[0]).includes(col)
    );

    if (missingColumns.length > 0) {
      await client.pushMessage(userId, {
        type: 'text',
        text: `CSVファイルに必要なカラムがありません: ${missingColumns.join(', ')}\n必要なカラム: 取引内容, 取引金額, 取引日\n\n見つかったカラム: ${parsedData.length > 0 ? Object.keys(parsedData[0]).join(', ') : 'なし'}`,
      });
      return;
    }

    // CSVデータから取引情報を抽出して正規化
    const transactions: {
      取引内容: string;
      取引金額: string;
      取引日: string;
    }[] = [];

    for (const row of parsedData) {
      try {
        // 取引金額の正規化
        let amount = `${row.取引金額}`.trim();
        // 金額の前に「-」がある場合は保持
        const isNegative = amount.startsWith('-');
        // 数字と小数点のみ残す（通貨記号や区切り文字を削除）
        amount = amount.replace(/[^\d.]/g, '');
        if (isNegative) amount = `-${amount}`;

        // 日付の正規化
        let date = `${row.取引日}`.trim();
        // 日付フォーマットの統一化
        if (date.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/)) {
          date = date.replace(/\//g, '-');
        } else if (date.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/)) {
          // DD/MM/YYYY または MM/DD/YYYY を YYYY-MM-DD に変換
          const parts = date.replace(/\//g, '-').split('-');
          if (parts.length === 3) {
            // 年が最後にある場合、順序を入れ替え
            date = `${parts[2]}-${parts[1]}-${parts[0]}`;
          }
        }

        transactions.push({
          取引内容: `${row.取引内容}`.trim(),
          取引金額: amount,
          取引日: date,
        });
      } catch (e) {
        console.error('行の処理中にエラーが発生しました:', e, '行データ:', row);
        // エラーがあっても処理を続行
      }
    }

    if (transactions.length === 0) {
      await client.pushMessage(userId, {
        type: 'text',
        text: '有効な取引データがCSVファイルに見つかりませんでした。',
      });
      return;
    }

    // 既存のトランザクションと統合
    const existingData = userDataStore[userId];
    let allTransactions = transactions;

    if (existingData && existingData.transactions.length > 0) {
      // 既存のデータがある場合は統合
      allTransactions = [...existingData.transactions, ...transactions];

      // 重複を除外（取引内容、金額、日付が完全一致する場合）
      const uniqueTransactions = new Map();
      allTransactions.forEach((tx) => {
        const key = `${tx.取引内容}-${tx.取引金額}-${tx.取引日}`;
        uniqueTransactions.set(key, tx);
      });

      allTransactions = Array.from(uniqueTransactions.values());
    }

    // ユーザーデータを更新
    userDataStore[userId] = {
      transactions: allTransactions,
      lastUpdated: Date.now(),
      metadata: {
        totalAmount: allTransactions.reduce((sum, tx) => {
          const amount = parseFloat(tx.取引金額) || 0;
          return sum + (amount > 0 ? amount : 0); // 支出のみを合計
        }, 0),
        fileCount: (existingData?.metadata?.fileCount || 0) + 1,
        lastFileName: fileName
      }
    };

    const totalFiles = existingData ? existingData.metadata?.fileCount || 0 + 1 : 1;

    // CSVファイルが正常に処理されたことを通知
    await client.pushMessage(userId, {
      type: 'text',
      text: `CSVファイル「${fileName}」の解析が完了しました。\n${transactions.length}件の取引データを抽出しました。\n${totalFiles > 1 ? `合計${allTransactions.length}件のデータが保存されています。` : ''}\n\n分析を開始するには「サブスク分析」と入力してください。別のCSVファイルを追加することもできます。`,
    });
  } catch (error) {
    console.error('CSVファイル処理中にエラーが発生しました:', error);
    await client.pushMessage(userId, {
      type: 'text',
      text: 'CSVファイルの処理中にエラーが発生しました。ファイルの形式を確認するか、しばらく経ってから再度お試しください。',
    });
  }
}

/**
 * 保存したデータから分析を実行する関数
 * @param userId ユーザーID
 */
async function analyzeUserData(userId: string) {
  const userData = userDataStore[userId];

  if (!userData || userData.transactions.length === 0) {
    return null;
  }

  return await analyzeTransactions(userData.transactions);
}

/**
 * 期限切れのデータをクリーンアップ
 */
function cleanupExpiredData() {
  const now = Date.now();

  Object.keys(userDataStore).forEach((userId) => {
    if (now - userDataStore[userId].lastUpdated > DATA_EXPIRY_MS) {
      delete userDataStore[userId];
    }
  });
}

/**
 * テキストメッセージを処理する関数
 * @param event LINEのWebhookイベント
 */
async function handleTextMessage(event: WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const messageText = event.message.text;
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  if (!userId) {
    console.error('ユーザーIDが取得できませんでした');
    return;
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
      });
      return;
    }

    await client.replyMessage(replyToken, {
      type: 'text',
      text: `${userDataStore[userId].transactions.length}件の取引データを分析しています。しばらくお待ちください...`,
    });

    try {
      // 保存されたデータから分析を実行
      const subscriptions = await analyzeUserData(userId);

      if (!subscriptions || subscriptions.length === 0) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'サブスクリプションが見つかりませんでした。取引データが存在しないか、サブスクリプションとして認識できる取引がありませんでした。',
        });
        return;
      }

      // 見やすい形式で結果を整形して送信
      const messages = formatSubscriptionsForDisplay(subscriptions, {
        detailed: false,
        categorySort: true
      });

      // 各メッセージを順に送信
      for (const message of messages) {
        await client.pushMessage(userId, {
          type: 'text',
          text: message,
        });
      }

      // 節約アドバイスの提供
      if (subscriptions.length >= 3) {
        const totalAmount = subscriptions.reduce((sum, sub) => sum + parseFloat(sub.取引金額), 0);

        // 重複サブスクのチェック
        const serviceCounts = {};
        const duplicateServices = [];

        subscriptions.forEach(sub => {
          // サービス名を標準化（小文字に変換して空白を削除）
          const normalizedService = (sub.サービス名 || '')
              .toLowerCase()
              .replace(/\s+/g, '');

          if (normalizedService) {
            serviceCounts[normalizedService] = (serviceCounts[normalizedService] || 0) + 1;

            // 2回以上出現したサービスを重複リストに追加
            if (serviceCounts[normalizedService] === 2) {
              duplicateServices.push(sub.サービス名);
            }
          }
        });

        // 節約アドバイスを提供
        let savingsTips = '💡 サブスク節約アドバイス:\n\n';

        // 重複サービスがあれば通知
        if (duplicateServices.length > 0) {
          savingsTips += `⚠️ 重複している可能性のあるサービス: ${duplicateServices.join(', ')}\n\n`;
        }

        // 重複サービスやオーバーラップするサービスを検出
        const streamingServices = subscriptions.filter(s =>
            s.取引内容.toLowerCase().includes('netflix') ||
            s.取引内容.toLowerCase().includes('amazon prime') ||
            s.取引内容.toLowerCase().includes('disney') ||
            s.取引内容.toLowerCase().includes('hulu')
        );

        if (streamingServices.length > 2) {
          savingsTips += '1️⃣ 動画ストリーミングサービスが複数見つかりました。一度に全てを契約するのではなく、視聴したいコンテンツがあるサービスを月替わりで契約するとコスト削減できます。\n\n';
        }

        // 使用頻度の低いサービスを見直す提案
        savingsTips += '2️⃣ 各サービスの利用頻度を見直し、あまり使っていないサービスは解約を検討しましょう。特に年間3,000円以上のサービスは重点的に見直すとよいでしょう。\n\n';

        // 年間プランへの変更提案
        savingsTips += '3️⃣ 長期利用予定のサービスは、月額プランから年間プランに変更すると10〜20%程度の節約になることが多いです。\n\n';

        // 無料プランや代替サービスの提案
        savingsTips += '4️⃣ 有料サービスの中には、機能制限はあるものの無料プランや代替の無料サービスがある場合もあります。目的に合わせて検討してみましょう。';

        await client.pushMessage(userId, {
          type: 'text',
          text: savingsTips,
        });
      }
    } catch (error) {
      console.error('データ分析中にエラーが発生しました:', error);

      // エラーメッセージの選択
      let errorMessage =
          'データの分析中にエラーが発生しました。もう一度お試しください。';

      if (error instanceof Error) {
        if (error.message.includes('タイムアウト')) {
          errorMessage =
              'データの処理に時間がかかりすぎています。取引データの量を減らして再度お試しください。';
        } else if (error.message.includes('サーバーエラー')) {
          errorMessage = error.message;
        }
      }

      await client.pushMessage(userId, {
        type: 'text',
        text: errorMessage,
      });
    }
    return;
  }

  // データのクリアコマンド
  if (messageText === 'データクリア') {
    if (userId in userDataStore) {
      delete userDataStore[userId];
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '保存されていたデータをすべて削除しました。',
      });
    } else {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '保存されているデータはありません。',
      });
    }
    return;
  }

  // データ統計コマンド
  if (messageText === 'データ統計') {
    if (userId in userDataStore) {
      const userData = userDataStore[userId];
      const stats = {
        取引数: userData.transactions.length,
        ファイル数: userData.metadata?.fileCount || 1,
        最終更新: new Date(userData.lastUpdated).toLocaleString('ja-JP'),
        総支出額: userData.metadata?.totalAmount || userData.transactions.reduce((sum, tx) => {
          const amount = parseFloat(tx.取引金額) || 0;
          return sum + (amount > 0 ? amount : 0); // 支出のみを合計
        }, 0)
      };

      await client.replyMessage(replyToken, {
        type: 'text',
        text: `📊 データ統計情報:\n\n・取引数: ${stats.取引数}件\n・読み込みファイル数: ${stats.ファイル数}件\n・最終更新: ${stats.最終更新}\n・総支出額: ${stats.総支出額.toLocaleString()}円\n\n「サブスク分析」コマンドで詳細な分析が可能です。`,
      });
    } else {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: '保存されているデータはありません。CSVファイルをアップロードしてください。',
      });
    }
    return;
  }

  // メッセージがサブスク検索コマンドかどうかを確認
  if (messageText.startsWith('サブスク検索')) {
    const parts = messageText.split(/\s+/);

    // コマンドの形式が正しいか確認
    if (parts.length !== 3) {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: 'フォーマットが正しくありません。「サブスク検索 メールアドレス パスワード」の形式で入力してください。',
      });
      return;
    }

    const email = parts[1];
    const password = parts[2];

    // 処理開始のメッセージを即時応答
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'サブスクリプションを検索しています。処理には最大で30分程度かかる場合があります。しばらくお待ちください...',
    });

    try {
      // 非同期でサブスク検索を実行
      const subscriptions = await getSubscriptions(email, password);

      // 結果が空の場合の処理
      if (!subscriptions || subscriptions.length === 0) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'サブスクリプションが見つかりませんでした。取引データが存在しないか、サブスクリプションとして認識できる取引がありませんでした。',
        });
        return;
      }

      // 結果を見やすい形式で整形して送信
      const messages = formatSubscriptionsForDisplay(subscriptions, {
        detailed: false,
        categorySort: true
      });

      // 各メッセージを順に送信
      for (const message of messages) {
        await client.pushMessage(userId, {
          type: 'text',
          text: message,
        });
      }
    } catch (error) {
      console.error('サブスクリプション検索中にエラーが発生しました:', error);

      let errorMessage = 'サブスクリプション検索中にエラーが発生しました。\n';

      // エラータイプに応じたメッセージ
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        errorMessage +=
            'リクエストがタイムアウトしました。データ量が多い場合は、期間を短くして再試行してください。';
      } else if (
          axios.isAxiosError(error) &&
          error.response &&
          error.response.status === 401
      ) {
        errorMessage +=
            'ログイン情報が正しくありません。メールアドレスとパスワードを確認してください。';
      } else if (axios.isAxiosError(error) && error.response) {
        errorMessage += `サーバーエラー: ${error.response.status} - ${error.response.statusText}`;
      } else if (error instanceof Error) {
        errorMessage += error.message;
      }

      // エラーメッセージをpushMessageで送信
      await client.pushMessage(userId, {
        type: 'text',
        text: errorMessage,
      });
    }

    return;
  }

  if (messageText === 'ヘルプ') {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '以下のコマンドが利用できます：\n\n'
          + '1. CSVファイルを送信: 取引データをアップロード\n'
          + '2. 「サブスク分析」: アップロードしたデータからサブスクリプションを分析\n'
          + '3. 「データ統計」: 現在保存されているデータの基本情報を表示\n'
          + '4. 「データクリア」: 保存されたデータを削除\n'
          + '5. 「サブスク検索 メールアドレス パスワード」: 従来の検索方法\n\n'
          + 'CSVファイルには「取引内容」「取引金額」「取引日」の列が必要です。複数のCSVファイルを送ることで、データを統合して分析できます。',
    });
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'サブスクリプションを分析するにはCSVファイルを送信するか、「サブスク検索 メールアドレス パスワード」と入力してください。利用可能なコマンドの一覧は「ヘルプ」で確認できます。',
    });
  }
}

/**
 * 取引データからサブスクリプションを検出する関数
 * @param transactions 取引データの配列
 * @returns 検出されたサブスクリプションの配列
 */
async function analyzeTransactions(
    transactions: { 取引内容: string; 取引金額: string; 取引日: string }[],
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];

  // 定期的な支払いパターンを検出するための情報
  interface TransactionPattern {
    取引内容: string;
    金額: number[];
    日付: string[];
  }

  // 同じ取引内容の支払いをグループ化
  const transactionGroups: Record<string, TransactionPattern> = {};

  // 各取引を処理
  for (const transaction of transactions) {
    try {
      // 取引内容の標準化（余分な空白や記号を削除）
      const normalizedContent = transaction.取引内容.replace(/\s+/g, ' ').trim();

      // 名前が100文字を超える場合はAmazonの注文と見なして除外
      if (normalizedContent.length > 100) {
        console.log(`長すぎる取引内容をスキップ: ${normalizedContent.substring(0, 50)}...`);
        continue;
      }

      // Amazon注文パターンに一致するか確認
      const isAmazonOrder = AMAZON_ORDER_PATTERNS.some(pattern =>
          pattern.test(normalizedContent)
      );

      // Amazonの注文で長い名前（70文字以上）の場合もスキップ
      if (isAmazonOrder && normalizedContent.length > 70) {
        console.log(`Amazon注文をスキップ: ${normalizedContent.substring(0, 50)}...`);
        continue;
      }

      // 金額を数値に変換（絶対値を使用）
      const amount = Math.abs(Number.parseFloat(transaction.取引金額) || 0);

      // 金額が0の場合はスキップ
      if (amount <= 0) continue;

      // 取引日の標準化
      const date = transaction.取引日.trim();

      // グループ化のために同じ取引内容のものをまとめる
      if (!transactionGroups[normalizedContent]) {
        transactionGroups[normalizedContent] = {
          取引内容: normalizedContent,
          金額: [],
          日付: [],
        };
      }

      transactionGroups[normalizedContent].金額.push(amount);
      transactionGroups[normalizedContent].日付.push(date);

      // キーワードマッチング（サービス名ベース）
      let highestScore = 0;
      let matchedService = null;
      let matchedKeywords: string[] = [];

      // 既知のサブスクサービスとマッチングを試みる
      for (const service of SUBSCRIPTION_SERVICES) {
        if (service.name.test(normalizedContent.toLowerCase())) {
          if (service.score > highestScore) {
            highestScore = service.score;
            matchedService = service;
            // サービス名をキーワードとして追加
            matchedKeywords = [service.name.toString().replace(/[\/\\^$*+?.()|[\]{}]/g, '')];
          }
        }
      }

      // サブスクの指標となるキーワードもチェック
      for (const { indicator, score } of SUBSCRIPTION_INDICATORS) {
        if (normalizedContent.toLowerCase().includes(indicator.toLowerCase())) {
          if (score > highestScore) {
            highestScore = score;
          }
          matchedKeywords.push(indicator);
        }
      }

      // 明らかにサブスクリプションでない場合は除外
      const nonSubContent = normalizedContent.toLowerCase();
      if (NON_SUBSCRIPTION_KEYWORDS.some(keyword => nonSubContent.includes(keyword))) {
        continue;
      }

      // サブスクの可能性が十分に高い場合のみ追加
      if (highestScore >= 0.5) {
        // 長い取引名の場合はスコアを下げる（名前が長いほどサブスクらしさは減少）
        if (normalizedContent.length > 50) {
          // 50文字を超えるごとに10%ずつスコアを下げる（最低0.3まで）
          const lengthPenalty = Math.min(0.2, (normalizedContent.length - 50) / 50 * 0.1);
          highestScore = Math.max(0.3, highestScore - lengthPenalty);
        }

        // サービス名が特定できた場合
        const serviceName = matchedService ?
            matchedService.name.toString().replace(/[\/\\^$*+?.()|[\]{}]/g, '') :
            '未特定サービス';

        const serviceInfo = matchedService ?
            `「${serviceName}」はサブスクリプションサービスです（カテゴリ: ${matchedService.category}）` :
            `キーワード「${matchedKeywords.join('、')}」に一致しました`;

        // 重複チェック（同じ取引内容が既に追加されていないか）
        const exists = subscriptions.some(
            (sub) => sub.取引内容 === normalizedContent,
        );

        if (!exists) {
          subscriptions.push({
            取引内容: normalizedContent,
            取引金額: amount.toString(),
            取引日: date,
            キーワード: matchedKeywords,
            サブスク確率: highestScore,
            理由: serviceInfo,
            サービス名: matchedService?.name.toString().replace(/[\/\\^$*+?.()|[\]{}]/g, ''),
          });
        }
      }
    } catch (e) {
      console.error('取引の分析中にエラーが発生しました:', e);
      // エラーがあっても処理を続行
    }
  }

  // 定期的な支払いパターンを検出
  for (const [content, pattern] of Object.entries(transactionGroups)) {
    // 既にサブスクリプションとして追加されていれば処理をスキップ
    if (subscriptions.some((sub) => sub.取引内容 === content)) {
      continue;
    }

    // 支払い回数
    const count = pattern.金額.length;

    // 少なくとも2回以上の支払いがある場合のみパターン分析
    if (count >= 2) {
      // 金額の一貫性をチェック（同じ金額が繰り返される場合）
      const uniqueAmounts = new Set(pattern.金額);
      const amountConsistency =
          uniqueAmounts.size === 1 ? 1 : 1 - uniqueAmounts.size / count;

      // 平均金額
      const avgAmount = pattern.金額.reduce((sum, amt) => sum + amt, 0) / count;

      // 金額が一貫していて、よくあるサブスク金額に近い場合、サブスクリプションの可能性が高い
      if (amountConsistency > 0.7 && avgAmount > 0) {
        // よくあるサブスク金額に近いかを確認
        const isCommonPrice = COMMON_SUBSCRIPTION_PRICES.some(price =>
            Math.abs(avgAmount - price) <= 100 // 100円の誤差を許容
        );

        const probability = 0.5 + (amountConsistency * 0.3) + (isCommonPrice ? 0.1 : 0);

        // 日付パターンの分析
        const dates = pattern.日付.map(d => new Date(d)).sort((a, b) => a.getTime() - b.getTime());
        const daysDiffs: number[] = [];

        for (let i = 1; i < dates.length; i++) {
          const diff = Math.abs(dates[i].getTime() - dates[i-1].getTime()) / (1000 * 60 * 60 * 24);
          daysDiffs.push(diff);
        }

        // 月次パターン (25-35日)
        const isMonthly = daysDiffs.some(d => d >= 25 && d <= 35);
        // 年次パターン (350-380日)
        const isYearly = daysDiffs.some(d => d >= 350 && d <= 380);

        let datePattern = '';
        let dateBonus = 0;

        if (isMonthly) {
          datePattern = '月次パターン検出';
          dateBonus = 0.1;
        } else if (isYearly) {
          datePattern = '年次パターン検出';
          dateBonus = 0.1;
        }

        subscriptions.push({
          取引内容: content,
          取引金額: avgAmount.toString(),
          取引日: pattern.日付[0], // 最初の取引日
          キーワード: [],
          サブスク確率: Math.min(0.95, probability + dateBonus),
          理由: `同じ金額(${avgAmount.toLocaleString()}円)で${count}回の支払いがあります。${datePattern ? `${datePattern}。` : ''}${isCommonPrice ? '一般的なサブスク金額に近い値です。' : ''}`,
        });
      }
    } else {
      // 1回だけの支払いの場合でも、金額が特定の範囲内ならサブスクの可能性あり
      const amount = pattern.金額[0];

      // よくあるサブスク金額に近いかを確認
      const isCommonPrice = COMMON_SUBSCRIPTION_PRICES.some(price =>
          Math.abs(amount - price) <= 50 // 50円の誤差を許容
      );

      // 非サブスクキーワードチェック
      const hasNonSubKeyword = NON_SUBSCRIPTION_KEYWORDS.some(keyword =>
          content.toLowerCase().includes(keyword)
      );

      if (amount > 0 && amount <= 10000 && isCommonPrice && !hasNonSubKeyword) {
        subscriptions.push({
          取引内容: content,
          取引金額: amount.toString(),
          取引日: pattern.日付[0],
          キーワード: [],
          サブスク確率: 0.4,
          理由: '一般的なサブスク金額に近い支払いがあります。定期的な支払いの可能性があります。',
        });
      }
    }
  }

  // サブスクリプションをグループ化して類似のものを検出
  const groupedSubscriptions = groupSubscriptionsByService(subscriptions);

  // 日付パターンの詳細分析を追加
  analyzeDatePatterns(groupedSubscriptions);

  // 最終的な結果をスコア順にソート
  return groupedSubscriptions.sort((a, b) => b.サブスク確率 - a.サブスク確率);
}

/**
 * サブスクリプションをサービス名でグループ化する関数
 * @param subscriptions サブスクリプションの配列
 * @returns グループ化されたサブスクリプションの配列
 */
function groupSubscriptionsByService(subscriptions: Subscription[]): Subscription[] {
  // サービス名の抽出関数
  const extractServiceName = (content: string): string => {
    content = content.toLowerCase();

    // 既知のサービス名のマッピング
    const servicePatterns = [
      { pattern: /netflix|ネットフリックス/i, name: 'Netflix' },
      { pattern: /spotify|スポティファイ/i, name: 'Spotify' },
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
  const serviceGroups: Record<string, Subscription[]> = {};

  subscriptions.forEach(result => {
    const serviceName = result.サービス名 || extractServiceName(result.取引内容);
    if (!serviceGroups[serviceName]) {
      serviceGroups[serviceName] = [];
    }
    serviceGroups[serviceName].push(result);
  });

  // 各グループにIDを付与
  const groupedResults: Subscription[] = [];
  let groupIdCounter = 1;

  Object.entries(serviceGroups).forEach(([serviceName, group]) => {
    if (group.length > 0) {
      const groupId = `group-${groupIdCounter++}`;

      group.forEach(result => {
        groupedResults.push({
          ...result,
          グループID: groupId,
          サービス名: serviceName
        });
      });
    }
  });

  return groupedResults;
}

/**
 * 日付パターン分析を実行する関数
 * @param groupedResults グループ化されたサブスクリプションの配列
 */
function analyzeDatePatterns(groupedResults: Subscription[]) {
  // 各グループの日付パターンを分析
  const groupCounts: Record<string, number> = {};

  // グループ数をカウント
  groupedResults.forEach(result => {
    if (result.グループID) {
      groupCounts[result.グループID] = (groupCounts[result.グループID] || 0) + 1;
    }
  });

  Object.entries(groupCounts).forEach(([groupId, count]) => {
    // 1つしかない場合はスキップ
    if (count <= 1) return;

    // このグループの全アイテムを取得
    const groupItems = groupedResults.filter(r => r.グループID === groupId);

    // 入金項目は処理しない
    if (groupItems.some(item => item.理由.includes('入金') || item.理由.includes('収入'))) {
      return;
    }

    // 明らかにサブスクでないものは処理しない
    if (groupItems.some(item => {
      const content = item.取引内容.toLowerCase();
      return NON_SUBSCRIPTION_KEYWORDS.some(keyword => content.includes(keyword));
    })) {
      return;
    }

    // 日付をパースして確実にソート
    const validDates: { result: Subscription; date: Date }[] = [];

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
    const monthlyGroups: Record<string, Subscription[]> = {};

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
    const monthlyPattern = dateDiffs.some(diff => diff >= 25 && diff <= 35);
    const yearlyPattern = dateDiffs.some(diff => diff >= 350 && diff <= 380);

    // ボーナススコア計算
    let patternBonus = 0;

    // 月次パターンを検出
    if (monthlyPattern) {
      patternBonus = 0.1;

      // 3ヶ月以上連続で月次パターンがある場合
      if (maxConsecutiveMonths >= 3) {
        patternBonus = 0.2;
      }
    }
    // 年次パターン
    else if (yearlyPattern) {
      patternBonus = 0.1;
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
            if (!groupedResults[index].理由.includes('月次')) {
              groupedResults[index].理由 += `、月次の支払いパターンを検出（${maxConsecutiveMonths}ヶ月連続）`;
            }
          } else if (yearlyPattern) {
            if (!groupedResults[index].理由.includes('年次')) {
              groupedResults[index].理由 += '、年次の支払いパターンを検出';
            }
          }
        }
      }
    });
  });
}

/**
 * 日付文字列をパース
 * @param dateStr 日付文字列
 * @returns Dateオブジェクト（無効な場合はnull）
 */
function parseDate(dateStr: string): Date | null {
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
}

// Webhookハンドラー
export async function POST(request: NextRequest) {
  try {
    // リクエストボディを取得
    const body = await request.text();
    const signature = request.headers.get('x-line-signature');

    // 署名検証
    if (
        !signature ||
        !validateSignature(body, config.channelSecret, signature)
    ) {
      return NextResponse.json({ error: '署名が無効です' }, { status: 401 });
    }

    // イベントをパース
    const events: WebhookEvent[] = JSON.parse(body).events;

    // 各イベントを処理
    await Promise.all(
        events.map(async (event) => {
          try {
            // メッセージイベントの場合
            if (event.type === 'message') {
              if (event.message.type === 'text') {
                await handleTextMessage(event);
              } else if (event.message.type === 'file') {
                await handleFileMessage(event);
              }
            }
            // 他のイベントタイプも必要に応じて追加
          } catch (err) {
            console.error('イベント処理中にエラーが発生しました:', err);
          }
        }),
    );

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhookハンドラーでエラーが発生しました:', error);
    return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 },
    );
  }
}

// LINE Platformからの認証チェック用
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'ok' });
}