import { NextRequest, NextResponse } from 'next/server'
import { processExpiredComplaintProposals } from '@/lib/services/complaint-sla'

export async function GET(req: NextRequest) {
  return handleExpire(req)
}

export async function POST(req: NextRequest) {
  return handleExpire(req)
}

async function handleExpire(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  // Fail-closed: Bắt buộc phải có CRON_SECRET được cấu hình
  if (!cronSecret || cronSecret.trim() === '') {
    console.error('CRON_SECRET is not configured on the server')
    return NextResponse.json(
      { success: false, error: 'Unauthorized: CRON_SECRET is not configured' },
      { status: 401 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Invalid CRON_SECRET' },
      { status: 401 }
    )
  }

  try {
    const result = await processExpiredComplaintProposals()
    return NextResponse.json({
      success: true,
      processedCount: result.processedCount,
      complaintIds: result.complaintIds,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error running processExpiredComplaintProposals cron:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown cron error',
      },
      { status: 500 }
    )
  }
}
