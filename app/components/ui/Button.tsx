import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
  secondary:
    'bg-muted text-foreground shadow-xs hover:bg-accent',
  outline:
    'border border-border bg-card text-foreground shadow-xs hover:bg-accent',
  ghost:
    'text-muted-foreground hover:bg-accent hover:text-foreground',
  destructive:
    'bg-destructive text-destructive-foreground shadow-xs hover:opacity-90',
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-sm',
  icon: 'h-9 w-9',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export default Button
