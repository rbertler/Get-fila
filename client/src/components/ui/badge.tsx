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
        weakPattern: 'border-transparent text-[#1a3b5c] bg-[#e6f0fa]',
        testResults: 'border-transparent text-[#153859] bg-[#c2dcf0]',
        condition: 'border-transparent text-[#225380] bg-[#96bddb]',
        surgery: 'border-transparent text-[#0f3352] bg-[#6b9cc4]',
        medication: 'border-transparent text-[#0a2238] bg-[#578bb8]',
        labReport: 'border-transparent text-[#d4e8f7] bg-[#36699c]',
        imaging: 'border-transparent text-[#f0f7fc] bg-[#2f6399]',
        prescription: 'border-transparent text-[#c4dff5] bg-[#29598f]',
        possiblePattern: 'border-transparent text-[#e6f2fa] bg-[#245282]',
        visitSummary: 'border-transparent text-[#b3d5f2] bg-[#1d4a80]',
        operativeReport: 'border-transparent text-[#d9eaf7] bg-[#1a426b]',
        aiSummary: 'border-transparent text-[#a1cbed] bg-[#143b6e]',
        supplement: 'border-transparent text-[#8fbfe8] bg-[#0c2d5c]',
        vaccination: 'border-transparent text-[#7ab2e3] bg-[#07214a]',
        strongPattern: 'border-transparent text-[#66a3db] bg-[#041638]',
        neutral: 'border-[#4a4e5a] text-[#4a4e5a] bg-white',
        extracted: 'border-transparent text-[#e5e7eb] bg-[#374151]',
        manual: 'border-transparent text-[#374151] bg-[#e5e7eb]',
        dark: 'border-transparent text-white bg-[#374151]',
        success: 'border-transparent text-[#276749] bg-[#e6f4ea]',
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
