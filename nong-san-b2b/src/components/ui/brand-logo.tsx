import Link from 'next/link'
import { cn } from 'cn'

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'light' | 'dark'
  showSubtitle?: boolean
  subtitleText?: string
  href?: string
  className?: string
  iconOnly?: boolean
}

export function BrandLogo({
  size = 'md',
  variant = 'light',
  showSubtitle = true,
  subtitleText = 'Phân phối sỉ trái cây chuẩn vườn',
  href,
  className,
  iconOnly = false,
}: BrandLogoProps) {
  const iconSizeClass =
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'

  const titleSizeClass =
    size === 'sm'
      ? 'text-lg'
      : size === 'lg'
      ? 'text-2xl'
      : 'text-xl'

  const subtitleSizeClass =
    size === 'sm'
      ? 'text-[10px]'
      : size === 'lg'
      ? 'text-xs'
      : 'text-[11px]'

  const isDark = variant === 'dark'

  const content = (
    <div className={cn('inline-flex items-center gap-2.5 group select-none', className)}>
      {/* Biểu tượng nhận diện E Vibe (Organic Emerald + Citrus Freshness Dot) */}
      <div
        className={cn(
          iconSizeClass,
          'relative rounded-xl bg-gradient-to-br from-[#059669] via-[#00855D] to-[#10B981] flex items-center justify-center shadow-xs transition-transform duration-200 group-hover:scale-105 shrink-0 ring-1 ring-emerald-500/20'
        )}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-5/6 h-5/6"
        >
          {/* Đường cong hình chữ 'e' cách điệu lá mầm hữu cơ */}
          <path
            d="M8.5 16.5C8.5 12.08 12.08 8.5 16.5 8.5C19.8 8.5 22.8 10.3 23.5 13.5C24 16.5 21.2 20.8 16.5 20.8C13.2 20.8 11.2 19.3 10.5 17.8"
            stroke="white"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <path
            d="M10.8 16.5H21.2"
            stroke="white"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          {/* Mầm quả Citrus Accent (#84CC16) thể hiện sức sống & nông sản tươi mới */}
          <circle
            cx="22"
            cy="10"
            r="2.2"
            fill="#84CC16"
            stroke="white"
            strokeWidth="1"
          />
        </svg>
      </div>

      {/* Phần chữ Wordmark E Vibe */}
      {!iconOnly && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                'font-heading font-extrabold tracking-tight transition-colors',
                titleSizeClass,
                isDark ? 'text-white' : 'text-slate-900 group-hover:text-emerald-700'
              )}
            >
              E Vibe
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#84CC16] shrink-0 mt-1" />
          </div>

          {showSubtitle && (
            <span
              className={cn(
                'font-sans font-medium uppercase tracking-wider block',
                subtitleSizeClass,
                isDark ? 'text-emerald-400/90' : 'text-slate-500'
              )}
            >
              {subtitleText}
            </span>
          )}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="inline-flex">
        {content}
      </Link>
    )
  }

  return content
}
