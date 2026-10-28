'use client'

/**
 * F03 — ADMIN EXECUTIVE AI ASSISTANT COMPONENT
 * E Vibe — Nông Sản B2B
 *
 * Interactive AI Assistant interface embedded in Admin Reports.
 * Provides instant conversational insights on revenue, cashflow, complaints, and FEFO inventory.
 */

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Bot,
  User,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  queryAdminExecutiveAiAction,
  getAdminAiStatusAction,
} from '@/server/actions/admin-ai'
import { AdminAiStatus, GeminiQueryResult } from '@/lib/gemini/types'
import { toast } from 'sonner'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  model?: string
  error?: boolean
}

let messageCounter = 0
function createMessageId(role: string): string {
  messageCounter += 1
  return `${role}-${messageCounter}`
}

function getVietnamTimeString(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date())
}

const PRESET_PROMPTS = [
  'Tóm tắt doanh thu và tình hình đơn hàng 30 ngày qua',
  'Top sản phẩm bán chạy nhất và tỷ lệ khiếu nại',
  'Cảnh báo các lô hàng tồn kho FEFO sắp hết hạn',
  'Đánh giá hiệu quả kinh doanh theo nhóm khách hàng B2B',
]

export function AdminAiAssistant() {
  const [isOpen, setIsOpen] = useState(true)
  const [inputQuery, setInputQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<AdminAiStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Tải trạng thái kết nối Gemini khi mount
  useEffect(() => {
    let isMounted = true
    async function checkStatus() {
      try {
        const res = await getAdminAiStatusAction()
        if (isMounted) {
          setStatus(res)
          setIsLoadingStatus(false)
        }
      } catch {
        if (isMounted) {
          setStatus({
            configured: false,
            statusMessage: 'Không thể kiểm tra trạng thái API.',
          })
          setIsLoadingStatus(false)
        }
      }
    }
    checkStatus()
    return () => {
      isMounted = false
    }
  }, [])

  // Tự động cuộn xuống khi có tin nhắn mới
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isPending])

  const handleSend = useCallback((queryToSend?: string) => {
    const text = (queryToSend || inputQuery).trim()
    if (!text || isPending) return

    const userMsg: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: text,
      timestamp: getVietnamTimeString(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputQuery('')

    startTransition(async () => {
      try {
        const res: GeminiQueryResult = await queryAdminExecutiveAiAction({
          query: text,
          model: status?.activeModel,
        })

        if (res.success && res.answer) {
          const assistantMsg: ChatMessage = {
            id: createMessageId('assistant'),
            role: 'assistant',
            content: res.answer,
            timestamp: getVietnamTimeString(),
            model: res.metadata?.model,
          }
          setMessages((prev) => [...prev, assistantMsg])
        } else {
          const errorMsg: ChatMessage = {
            id: createMessageId('error'),
            role: 'assistant',
            content: res.message || 'Đã xảy ra lỗi không xác định khi gọi trợ lý AI.',
            timestamp: getVietnamTimeString(),
            error: true,
          }
          setMessages((prev) => [...prev, errorMsg])
        }
      } catch (err: unknown) {
        const fallbackMsg: ChatMessage = {
          id: createMessageId('error'),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Lỗi kết nối máy chủ khi gọi trợ lý AI.',
          timestamp: getVietnamTimeString(),
          error: true,
        }
        setMessages((prev) => [...prev, fallbackMsg])
      }
    })
  }, [inputQuery, isPending, status])

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('Đã sao chép phản hồi vào bộ nhớ tạm')
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white overflow-hidden transition-all">
      {/* Header */}
      <CardHeader className="p-5 sm:p-6 bg-gradient-to-r from-emerald-50/70 via-teal-50/40 to-white border-b border-slate-100 flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <CardTitle className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              Trợ Lý Quản Trị AI (Gemini Assistant)
              <Badge variant="outline" className="text-[11px] font-semibold bg-emerald-100/70 text-emerald-800 border-emerald-300">
                F03 Executive
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Phân tích báo cáo kinh doanh, tài chính, khiếu nại và tồn kho FEFO theo thời gian thực.
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status Badge */}
          {isLoadingStatus ? (
            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 animate-pulse">
              Đang kiểm tra...
            </Badge>
          ) : status?.configured ? (
            <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              {status.activeModel || 'Gemini Flash'}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Chưa cấu hình Key
            </Badge>
          )}

          {/* Toggle Expand/Collapse */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            className="h-8 w-8 p-0 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100"
            aria-label={isOpen ? 'Thu gọn' : 'Mở rộng'}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>

      {/* Collapsible Content */}
      {isOpen && (
        <CardContent className="p-5 sm:p-6 space-y-4">
          {/* Missing API Key Warning Callout */}
          {!isLoadingStatus && !status?.configured && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-900 text-xs sm:text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-950">Chưa cấu hình Gemini API Key trên máy chủ</p>
                <p className="text-amber-800 leading-relaxed">
                  Để kích hoạt trợ lý AI, quản trị viên cần bổ sung biến môi trường{' '}
                  <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono font-semibold text-amber-900">
                    GEMINI_API_KEY
                  </code>{' '}
                  vào tệp <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono">.env.local</code> hoặc trên Vercel Project Settings.
                </p>
              </div>
            </div>
          )}

          {/* Prompt Suggestions */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-emerald-600" /> Gợi ý câu hỏi nhanh:
            </span>
            <div className="flex flex-wrap gap-2">
              {PRESET_PROMPTS.map((prompt, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleSend(prompt)}
                  className="text-xs bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300 rounded-xl px-3 py-1.5 text-left transition-colors font-medium disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Chat Messages Log */}
          {messages.length > 0 && (
            <div className="max-h-[420px] overflow-y-auto space-y-3.5 pr-2 pt-2 pb-1 border-t border-slate-100">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white text-xs ${msg.error ? 'bg-rose-500' : 'bg-emerald-600'}`}>
                      {msg.error ? <AlertTriangle className="w-3.5 h-3.5" /> : <Bot className="w-4 h-4" />}
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-emerald-600 text-white rounded-tr-xs'
                        : msg.error
                        ? 'bg-rose-50 text-rose-900 border border-rose-200 rounded-tl-xs'
                        : 'bg-slate-50 text-slate-800 border border-slate-200/80 rounded-tl-xs'
                    }`}
                  >
                    {/* Render message content */}
                    <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                    {/* Metadata & Actions for Assistant */}
                    {msg.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                        <div className="flex items-center gap-2">
                          <span>{msg.timestamp}</span>
                          {msg.model && (
                            <span className="font-mono bg-slate-200/60 px-1.5 py-0.2 rounded text-[10px] text-slate-600">
                              {msg.model}
                            </span>
                          )}
                        </div>
                        {!msg.error && (
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-emerald-700 transition-colors"
                            title="Sao chép câu trả lời"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-600">Đã sao chép</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Sao chép</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-slate-700 text-white flex items-center justify-center shrink-0 text-xs">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              ))}

              {/* Pending Loading State */}
              {isPending && (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-xs p-3.5 text-xs text-slate-600 flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    <span>Gemini đang phân tích số liệu báo cáo và tồn kho FEFO...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="pt-2"
          >
            <div className="relative rounded-2xl border border-slate-200 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 bg-slate-50/50 transition-all">
              <textarea
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                disabled={isPending}
                placeholder="Đặt câu hỏi về doanh thu, khiếu nại, dự báo hoặc hàng tồn kho..."
                rows={2}
                maxLength={500}
                className="w-full bg-transparent px-4 py-3 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none disabled:opacity-50"
              />

              <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Dữ liệu báo cáo nội bộ đã khử PII</span>
                  <span>•</span>
                  <span>{inputQuery.length}/500</span>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  disabled={!inputQuery.trim() || isPending}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 h-8 gap-1.5 text-xs font-semibold shadow-sm"
                >
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>Gửi</span>
                      <Send className="w-3.5 h-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
