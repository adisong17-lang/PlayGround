import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'

export function Pill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'lime' | 'mint' | 'red' | 'amber' | 'cyan' | 'violet'
  className?: string
}) {
  return <span className={`pill ${tone} ${className}`.trim()}>{children}</span>
}

export function StatusDot({ tone = 'neutral', pulse = false }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; pulse?: boolean }) {
  return <span className={`dot ${tone} ${pulse ? 'pulse' : ''}`.trim()} aria-hidden="true" />
}

export function Button({
  variant = 'default',
  size = 'default',
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'default' | 'small'
}) {
  return (
    <button
      className={`btn ${variant === 'default' ? '' : variant} ${size === 'small' ? 'small' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string
  title: string
  subtitle: string
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{subtitle}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function MiniSparkline({
  data,
  positive = true,
  width = 64,
  height = 22,
  fill = false,
}: {
  data: number[]
  positive?: boolean
  width?: number
  height?: number
  fill?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(1, data.length - 1)) * width
      const y = height - 2 - ((value - min) / span) * (height - 4)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const color = positive ? '#63e6be' : '#ff6f86'
  const area = `0,${height} ${points} ${width},${height}`
  return (
    <svg
      className="mini-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`price trend ${positive ? 'up' : 'down'}`}
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <polygon points={area} fill={`url(#spark-${id})`} /> : null}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={option === value ? 'active' : ''}
          onClick={() => onChange(option)}
          aria-pressed={option === value}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`.trim()}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="sr-only">{label}</span>
    </button>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        style={wide ? { width: 'min(680px, calc(100vw - 28px))' } : undefined}
      >
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close dialog">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  subtitle,
  confirmLabel,
  tone = 'primary',
  children,
  disabled = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  subtitle?: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={disabled}>
            <Check /> {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

export function ProgressBar({ value, tone = 'lime' }: { value: number; tone?: 'lime' | 'amber' | 'red' }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={`progress ${tone === 'lime' ? '' : tone}`.trim()} aria-hidden="true">
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      {icon}
      <div className="empty-title">{title}</div>
      <p className="empty-text">{text}</p>
    </div>
  )
}
