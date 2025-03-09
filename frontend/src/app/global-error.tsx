'use client'

import { Button } from '@/client/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/client/components/ui/dialog.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/client/components/ui/table.tsx'
import { format } from 'date-fns'
import Link from 'next/link'
import { useMemo, useState } from 'react'

export default function GlobalError({
  error,
}: { error: Error & { digest?: string } }) {
  const [open, setOpen] = useState(true)

  const errorDetails = useMemo(() => {
    return [
      {
        label: '発生時刻',
        value: format(new Date(), 'yyyy/MM/dd HH:mm:ss'),
      },
      {
        label: '対象URL',
        value: location.href,
      },
      {
        label: 'エラー内容',
        value: String(error),
      },
    ]
  }, [error])

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className={'text-sm font-semibold text-neutral-700'}>
            <p className={'mt-1'}>予期せぬエラーが発生しました。</p>
          </DialogTitle>
        </DialogHeader>
        <Table className={'text-xs'}>
          <TableHeader>
            <TableRow>
              <TableHead className={'w-[100px]'}>項目</TableHead>
              <TableHead>詳細</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errorDetails.map((item) => (
              <TableRow key={item.label}>
                <TableCell className={'font-medium'}>{item.label}</TableCell>
                <TableCell className={'line-clamp-3 break-all'}>
                  {item.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter>
          <Link className={'flex-1'} href={'/'}>
            <Button className={'w-full'} size={'sm'} variant={'outline'}>
              トップに戻る
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
