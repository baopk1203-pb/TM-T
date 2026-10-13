import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Construction } from 'lucide-react'

export function AdminPlaceholder({
  title,
  phase,
  description,
}: {
  title: string
  phase: string
  description: string
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-300">
          Quy hoạch ở {phase}
        </Badge>
      </div>

      <Card className="border-slate-200">
        <CardContent className="py-16 text-center text-slate-500">
          <Construction className="w-12 h-12 mx-auto text-amber-500 mb-3" />
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <p className="text-sm mt-1 max-w-md mx-auto text-slate-600">{description}</p>
          <div className="mt-4">
            <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
              Checklist: {phase}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
