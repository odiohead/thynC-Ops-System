import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'outline'

const VARIANT: Record<Variant, string> = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-subtle text-primary-subtle-foreground',
  success: 'bg-success-subtle text-success-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  destructive: 'bg-destructive-subtle text-destructive-subtle-foreground',
  outline: 'border border-border text-muted-foreground',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
}

export default function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        VARIANT[variant],
        className
      )}
      {...props}
    />
  )
}
