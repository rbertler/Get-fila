import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-[#102a45] border-[#102a45]',
        referral: 'border-transparent text-[#1a6b5c] bg-[#cce9e6]',
        medication: 'border-transparent text-[#102a45] bg-[#457aab]/60',
        labReport: 'border-transparent text-[#102a45] bg-[#d6e6f5]',
        imaging: 'border-transparent text-[#102a45] bg-[#d6e6f5]',
        testResults: 'border-transparent text-[#102a45] bg-[#d6e6f5]',
        surgery: 'border-transparent text-[#124d47] bg-[#adcce6]',
        condition: 'border-transparent text-[#102a45] bg-[#244a73]/60',
        neutral: 'border-[#4a4e5a] text-[#4a4e5a] bg-white',
        extracted: 'border-transparent text-[#e5e7eb] bg-[#374151]',
        manual: 'border-transparent text-[#374151] bg-[#e5e7eb]',
        dark: 'border-transparent text-white bg-[#374151]',
        prescription: 'border-transparent text-[#102a45] bg-[#adcce6]',
        visitSummary: 'border-transparent text-[#102a45] bg-[#d6e6f5]',
        operativeReport: 'border-transparent text-[#124d47] bg-[#adcce6]',
        aiSummary: 'border-transparent text-white bg-[#102a45]',
        supplement: 'border-transparent text-[#102a45] bg-[#adcce6]',
        success: 'border-transparent text-[#276749]' + ' ' + 'bg-[#e6f4ea]',
        vaccination: 'border-transparent text-[#102a45] bg-[#d6e6f5]',
        warning: 'border-transparent text-[#7f2222] bg-[#fde8e8]',
        info: 'border-transparent bg-blue-100 text-blue-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
