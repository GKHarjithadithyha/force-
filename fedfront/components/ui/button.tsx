import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50', {
  variants: {
    variant: { default: 'bg-accent text-[var(--on-accent)] hover:brightness-110', secondary: 'border border-border bg-panel-raised text-text hover:bg-panel', ghost: 'text-[var(--text-secondary)] hover:bg-[var(--row-hover)]', destructive: 'border border-[var(--bad-border)] bg-[var(--bad-bg-soft)] text-[var(--bad-text)] hover:bg-[var(--bad-bg)]' },
    size: { default: 'h-10 px-4 py-2', sm: 'h-9 px-3', icon: 'h-10 w-10' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props}/>;
}
