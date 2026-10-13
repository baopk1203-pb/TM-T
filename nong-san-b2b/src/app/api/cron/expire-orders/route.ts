import { NextRequest, NextResponse } from 'next/server'
import { expireOrdersJob } from '@/actions/admin-order'

export async function GET(req: NextRequest) {
  return handleExpire(req)
}

export async function POST(req: NextRequest) {
  return handleExpire(req)
}

async function handleExpire(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid CRON_SECRET' },
        { status: 401 }
      )
    }
  }

  try {
    const result = await expireOrdersJob()
    return NextResponse.json({
      success: true,
      expiredCount: result.expiredCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error running expireOrdersJob cron:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown cron error',
      },
      { status: 500 }
    )
  }
}
