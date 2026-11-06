/**
 * Service: Xét hạng thành viên theo quý & tự động hóa (F04-03)
 * Tách biệt khỏi các tác vụ công khai, bảo đảm:
 * - Idempotency (Chống chạy lặp / ghi trùng log)
 * - Concurrency Safety (Giao dịch an toàn qua Prisma Transaction)
 * - Không sửa đè kết quả của kỳ mới hơn bằng kỳ cũ
 * - Xử lý đúng bảo lưu 15 ngày cuối quý và hệ số khách hàng mới
 */

import { db } from '@/lib/db'
import {
  Role,
  OrderStatus,
  CancelActor,
  ComplaintStatus,
  Resolution,
  Prisma,
} from '@prisma/client'
import {
  getPrecedingQuarterCode,
  evaluateCustomerQuarterlyMembership,
  CustomerEvaluationDecision,
  CandidateOrder,
} from '@/lib/domain/membership-evaluation'
import { MembershipTier } from '@/lib/domain/membership'

export interface EvaluationRunOptions {
  evaluationQuarter?: string
  now?: Date
}

export interface EvaluationRunResult {
  success: boolean
  evaluationQuarter: string
  evaluatedCount: number
  carryoverSkippedCount: number
  alreadyEvaluatedCount: number
  totalEligibleUsers: number
  decisions: CustomerEvaluationDecision[]
  error?: string
}

interface UserQueryResult {
  id: string
  role: Role
  createdAt: Date
  membershipTier?: MembershipTier | null
  orders: Array<{
    id: string
    code: string
    status: OrderStatus
    createdAt: Date
    total: number
    finalTotal?: number | null
    cancelledBy?: CancelActor | null
    cancelReason?: string | null
    items: Array<{
      isSample?: boolean
      weightGrams?: number
      actualWeightGrams?: number | null
    }>
    complaints: Array<{
      status: ComplaintStatus
      resolution?: Resolution | null
      compensation?: number | null
    }>
    events: Array<{
      type: string
    }>
  }>
  membershipLogs: Array<{
    id: string
    evaluationQuarter: string
    evaluatedAt: Date
  }>
}

interface ExtendedTx {
  membershipEvaluationLog: {
    findUnique: (args: {
      where: {
        userId_evaluationQuarter: {
          userId: string
          evaluationQuarter: string
        }
      }
    }) => Promise<unknown>
    findMany: (args: {
      where: {
        userId: string
        evaluationQuarter: { gt: string }
      }
    }) => Promise<Array<{ id: string; evaluationQuarter: string }>>
    create: (args: {
      data: {
        userId: string
        evaluationQuarter: string
        score: number
        previousTier?: MembershipTier | null
        newTier: MembershipTier
        evaluatedAt: Date
      }
    }) => Promise<unknown>
  }
  user: {
    update: (args: {
      where: { id: string }
      data: {
        membershipTier: MembershipTier
        tierUpdatedAt: Date
      }
    }) => Promise<unknown>
  }
}

/**
 * Thực hiện chu kỳ xét hạng định kỳ theo quý
 */
export async function runQuarterlyEvaluation(
  options: EvaluationRunOptions = {}
): Promise<EvaluationRunResult> {
  const now = options.now ?? new Date()
  const targetQuarterCode = options.evaluationQuarter ?? getPrecedingQuarterCode(now)

  try {
    const userModel = db.user as unknown as {
      findMany: (args: object) => Promise<UserQueryResult[]>
    }
    const candidateUsers = await userModel.findMany({
      where: {
        role: Role.CUSTOMER,
      },
      include: {
        orders: {
          include: {
            items: true,
            complaints: true,
            events: true,
          },
        },
        membershipLogs: {
          select: {
            id: true,
            evaluationQuarter: true,
            evaluatedAt: true,
          },
        },
      },
    })

    let evaluatedCount = 0
    let carryoverSkippedCount = 0
    let alreadyEvaluatedCount = 0
    const decisions: CustomerEvaluationDecision[] = []

    for (const user of candidateUsers) {
      // 1. Kiểm tra Idempotency: Người dùng đã được đánh giá cho quý này chưa
      const hasLogForQuarter = user.membershipLogs.some(
        (log) => log.evaluationQuarter === targetQuarterCode
      )

      if (hasLogForQuarter) {
        alreadyEvaluatedCount++
        decisions.push({
          userId: user.id,
          targetQuarterCode,
          action: 'EVALUATE',
          reason: `Đã được đánh giá trước đó cho quý ${targetQuarterCode} (Bỏ qua để đảm bảo Idempotency).`,
          previousTier: user.membershipTier ?? null,
          newTier: user.membershipTier ?? 'BRONZE',
        })
        continue
      }

      // 2. Chuyển đổi dữ liệu đơn hàng sang CandidateOrder của domain
      const candidateOrders: CandidateOrder[] = user.orders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        createdAt: o.createdAt,
        total: o.total,
        finalTotal: o.finalTotal,
        cancelledBy: o.cancelledBy,
        cancelReason: o.cancelReason,
        items: o.items.map((it) => ({
          isSample: (it as unknown as { isSample?: boolean }).isSample ?? false,
          orderedGrams: (it as unknown as { weightGrams?: number }).weightGrams ?? 0,
          actualGrams: (it as unknown as { actualWeightGrams?: number | null }).actualWeightGrams ?? null,
        })),
        complaints: o.complaints.map((c) => ({
          status: c.status,
          resolution: c.resolution,
          compensation: c.compensation,
        })),
        events: o.events.map((e) => ({
          type: e.type,
        })),
      }))

      // 3. Ra quyết định bằng Domain Pure Function
      const decision = evaluateCustomerQuarterlyMembership({
        userId: user.id,
        userCreatedAt: user.createdAt,
        currentTier: user.membershipTier ?? null,
        hasPriorEvaluationLogs: user.membershipLogs.length > 0,
        orders: candidateOrders,
        targetQuarterCode,
      })

      decisions.push(decision)

      // Nếu thuộc diện bảo lưu -> không ghi log, không đổi hạng ở quý này
      if (decision.action === 'CARRYOVER_SKIP') {
        carryoverSkippedCount++
        continue
      }

      // 4. Thực thi trong Prisma Transaction bảo đảm Idempotency và Concurrency an toàn
      try {
        await db.$transaction(async (rawTx) => {
          const tx = rawTx as unknown as ExtendedTx
          // Khóa kiểm tra lại bên trong transaction
          const existing = await tx.membershipEvaluationLog.findUnique({
            where: {
              userId_evaluationQuarter: {
                userId: user.id,
                evaluationQuarter: targetQuarterCode,
              },
            },
          })

          if (existing) {
            alreadyEvaluatedCount++
            return
          }

          // Kiểm tra xem người dùng đã có log của quý mới hơn hay không
          // (Ngăn chặn việc chạy lại quý cũ ghi đè hạng của quý mới hơn)
          const newerLogs = await tx.membershipEvaluationLog.findMany({
            where: {
              userId: user.id,
              evaluationQuarter: { gt: targetQuarterCode },
            },
          })

          // Tạo bản ghi lịch sử đánh giá
          await tx.membershipEvaluationLog.create({
            data: {
              userId: user.id,
              evaluationQuarter: targetQuarterCode,
              score: decision.kpiResult ? decision.kpiResult.totalScore : 0,
              previousTier: decision.previousTier,
              newTier: decision.newTier,
              evaluatedAt: now,
            },
          })

          // Chỉ cập nhật hạng người dùng nếu không có log quý mới hơn
          if (newerLogs.length === 0) {
            await tx.user.update({
              where: { id: user.id },
              data: {
                membershipTier: decision.newTier,
                tierUpdatedAt: now,
              },
            })
          }

          evaluatedCount++
        })
      } catch (err: unknown) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Xung đột khóa duy nhất do tiến trình khác vừa tạo -> Idempotency an toàn
          alreadyEvaluatedCount++
        } else {
          throw err
        }
      }
    }

    return {
      success: true,
      evaluationQuarter: targetQuarterCode,
      evaluatedCount,
      carryoverSkippedCount,
      alreadyEvaluatedCount,
      totalEligibleUsers: candidateUsers.length,
      decisions,
    }
  } catch (error) {
    console.error(`Lỗi thực thi Quarterly Membership Evaluation (${targetQuarterCode}):`, error)
    return {
      success: false,
      evaluationQuarter: targetQuarterCode,
      evaluatedCount: 0,
      carryoverSkippedCount: 0,
      alreadyEvaluatedCount: 0,
      totalEligibleUsers: 0,
      decisions: [],
      error: error instanceof Error ? error.message : 'Unknown evaluation error',
    }
  }
}
