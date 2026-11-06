import { NextRequest, NextResponse } from 'next/server'
import { processRecurringSchedules } from '@/lib/services/recurring-generator'

export async function GET(req: NextRequest) {
  return handleRecurringCron(req)
}

export async function POST(req: NextRequest) {
  return handleRecurringCron(req)
}

async function handleRecurringCron(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  // Fail-closed: Bắt buộc phải cấu hình CRON_SECRET trên server
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
    const result = await processRecurringSchedules()
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? 'Failed to process recurring schedules',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      createdCount: result.createdCount,
      skippedDuplicates: result.skippedDuplicates,
      processedSchedules: result.processedSchedules,
      createdOrderCodes: result.createdOrderCodes,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error running processRecurringSchedules cron:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown cron error',
      },
      { status: 500 }
    )
  }
}
