'use client'

import { Button } from '@/client/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/client/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/client/components/ui/form'
import { Input } from '@/client/components/ui/input'
import { Progress } from '@/client/components/ui/progress'
import { Separator } from '@/client/components/ui/separator'
import { Skeleton } from '@/client/components/ui/skeleton'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

type FormData = {
  email: string
  password: string
}

type SubscriptionResult = {
  id: string
  name: string
  price: number
  billingCycle: string
}

export default function Finder() {
  const [step, setStep] = useState<'auth' | 'analyzing' | 'results'>('auth')
  const [results, setResults] = useState<SubscriptionResult[]>([])
  const [progress, setProgress] = useState(0)
  const [processingStage, setProcessingStage] = useState('')

  const form = useForm<FormData>({
    defaultValues: {
      email: '',
      password: '',
    },
  })

  // 解析中の進捗アニメーション
  useEffect(() => {
    if (step === 'analyzing') {
      // 20分 = 1200秒で95%まで到達するように設定
      // 1200秒 / 95% = 約12.6秒で1%進む
      const incrementInterval = 1000 // 1秒ごとに更新
      const incrementValue = 0.08 // 1秒あたり0.08%増加（≒20分で95%）

      const timer = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + incrementValue

          // 進捗に応じて処理段階を更新
          if (newProgress <= 10) {
            setProcessingStage('Money Forwardにログイン中...')
          } else if (newProgress <= 30) {
            setProcessingStage('取引データを取得中...')
          } else if (newProgress <= 50) {
            setProcessingStage('サブスクリプションデータを抽出中...')
          } else if (newProgress <= 70) {
            setProcessingStage('データを解析中...')
          } else if (newProgress <= 90) {
            setProcessingStage('サブスクリプションを特定中...')
          } else {
            setProcessingStage('結果を準備中...')
          }

          if (newProgress >= 95) {
            clearInterval(timer)
            return 95
          }
          return newProgress
        })
      }, incrementInterval)

      return () => {
        clearInterval(timer)
        setProgress(0)
        setProcessingStage('')
      }
    }
  }, [step])

  const onSubmit = async (data: FormData) => {
    setStep('analyzing')
    setProgress(0)
    setProcessingStage('開始しています...')
    toast(
      'サブスクリプションの分析を開始しました。完了までしばらくお待ちください。',
    )

    try {
      const response = await fetch('/api/finder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '分析中にエラーが発生しました')
      }

      // 進捗を100%に設定
      setProgress(100)
      setProcessingStage('完了しました！')

      const subscriptions = await response.json()
      setResults(subscriptions)

      // 少し待ってから結果画面に遷移
      setTimeout(() => {
        setStep('results')
        toast.success('サブスクリプションの分析が完了しました！')
      }, 500)
    } catch (error) {
      console.error('分析中にエラーが発生しました:', error)
      toast.error(
        `エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
      )
      setStep('auth')
    }
  }

  return (
    <div className="container mx-auto py-10">
      {step === 'auth' && (
        <Card>
          <CardHeader>
            <CardTitle>Money Forwardの認証情報を入力</CardTitle>
            <CardDescription>
              Money Forwardの認証情報を入力してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>メールアドレス</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="example@example.com"
                          type="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>パスワード</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="••••••••"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full">
                  認証
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {step === 'analyzing' && (
        <Card className="text-center">
          <CardHeader>
            <CardTitle>解析中...</CardTitle>
            <CardDescription>
              サブスクリプションを検索しています。しばらくお待ちください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 py-10">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{Math.round(progress)}%</span>
                <span>約20分かかります</span>
              </div>
              <Progress value={progress} className="h-2 w-full" />
              <p className="text-sm font-medium mt-2">{processingStage}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* サブスクリプションカードのスケルトン */}
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-3">
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-3">
              <p className="text-sm text-muted-foreground">処理状況:</p>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'results' && (
        <Card>
          <CardHeader>
            <CardTitle>検出されたサブスクリプション</CardTitle>
            <CardDescription>
              {results.length === 0
                ? 'サブスクリプションが見つかりませんでした。'
                : `${results.length}件のサブスクリプションが見つかりました。`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {results.length > 0 && (
              <div className="space-y-4">
                {results.map((sub) => (
                  <div key={sub.id} className="rounded-lg border p-4">
                    <div className="font-medium">{sub.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {sub.billingCycle}: {sub.price}円
                    </div>
                  </div>
                ))}
                <Separator className="my-4" />
                <div className="font-medium text-lg">
                  合計: {results.reduce((sum, sub) => sum + sub.price, 0)}円/月
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStep('auth')}
            >
              最初からやり直す
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
