import {Card} from "@/client/components/ui/card.tsx";

type Props = {
  message: string
}

export default function NoData({ message }: Props) {
  return (
    <Card className={'flex justify-center items-center p-4'}>
      <div className={'flex flex-col justify-center items-center space-y-4'}>
        <p className={'text-sm font-medium text-neutral-600'}>{message}</p>
      </div>
    </Card>
  )
}
