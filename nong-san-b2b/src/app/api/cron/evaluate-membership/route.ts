import { NextRequest, NextResponse } from 'next/server'
import { runQuarterlyEvaluation } from '@/lib/services/membership-evaluation'

export async function GET(req: NextRequest) {
  return handleQuarterlyEvaluation(req)
}

export async function POST(req: NextRequest) {
  return handleQuarterlyEvaluation(req)
}

async function handleQuarterlyEvaluation(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  // Fail-closed: Bắt buộc phải có CRON_SECRET được cấu hình (SRC-SEC-05)
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
    const { searchParams } = new URL(req.url)
    const quarterParam = searchParams.get('quarter') || undefined

    const result = await runQuarterlyEvaluation({
      evaluationQuarter: quarterParam,
      now: new Date(),
    })

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      evaluationQuarter: result.evaluationQuarter,
      evaluatedCount: result.evaluatedCount,
      carryoverSkippedCount: result.carryoverSkippedCount,
      alreadyEvaluatedCount: result.alreadyEvaluatedCount,
      totalEligibleUsers: result.totalEligibleUsers,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error running quarterly membership evaluation cron:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown evaluation error',
      },
      { status: 500 }
    )
  }
}
