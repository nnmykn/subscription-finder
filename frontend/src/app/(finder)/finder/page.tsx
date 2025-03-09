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
import { Separator } from '@/client/components/ui/separator'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

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

  const form = useForm<FormData>({
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const onSubmit = (data: FormData) => {
    setStep('analyzing')

    setTimeout(() => {
      const dummyResults: SubscriptionResult[] = [
        { id: '1', name: 'Netflix', price: 1490, billingCycle: '月額' },
        { id: '2', name: 'Amazon Prime', price: 500, billingCycle: '月額' },
        { id: '3', name: 'Spotify', price: 980, billingCycle: '月額' },
      ]

      setResults(dummyResults)
      setStep('results')
    }, 3000)
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
          <CardContent className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary" />
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
