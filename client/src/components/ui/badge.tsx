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
        outline: 'text-[#2b4257] border-[#2b4257]',
        referral: 'border-transparent text-[#4b5196] bg-[#dcddf0]',
        medication: 'border-transparent text-white bg-[#2b4257]',
        labReport: 'border-transparent text-[#777fc5] bg-[#d8dae8]',
        imaging: 'border-transparent text-[#5b63a8] bg-[#e0e1f0]',
        testResults: 'border-transparent text-white bg-[#777fc5]',
        surgery: 'border-transparent text-white bg-[#232861]',
        condition: 'border-transparent text-white bg-[#6da7cc]',
        neutral: 'border-[#4a4e5a] text-[#4a4e5a] bg-white',
        extracted: 'border-transparent text-[#e8e9ed] bg-[#4a4e5a]',
        manual: 'border-transparent text-[#4a4e5a] bg-[#e8e9ed]',
        dark: 'border-transparent text-white bg-[#4a4e5a]',
        prescription: 'border-transparent text-[#2f3573] bg-[#d4d5ea]',
        visitSummary: 'border-transparent text-[#3d4385] bg-[#d8d9ed]',
        operativeReport: 'border-transparent text-[#232861] bg-[#d0d1e7]',
        aiSummary: 'border-transparent text-white bg-[#2b4257]',
        supplement: 'border-transparent text-[#2b4257] bg-[#c8ddf0]',
        success: 'border-transparent text-[#276749]' + ' ' + 'bg-[#e6f4ea]',
        vaccination: 'border-transparent text-white bg-[#6b3a5e]',
        warning: 'border-transparent bg-[#5c3a6e] text-white',
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
