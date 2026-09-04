import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* One size per band of the design — the values are measured off the two
   Paper anchors, so they are true constants rather than a scale. Every
   headline is Geist Mono 600. */
const headlineVariants = cva('font-geist-mono font-semibold', {
  variants: {
    size: {
      hero: 'text-[84px] leading-[92px] tracking-[-0.03em]',
      section: 'text-[44px] leading-[54px] tracking-[-0.02em]',
      product: 'text-[36px] leading-[46px]',
      infra: 'text-[64px] leading-[72px]',
      rewards: 'text-[52px] leading-[62px] tracking-[-1.5px]',
      close: 'text-[54px] leading-[58px]',
      mobile: 'text-[34px] leading-[42px] tracking-[-0.02em]',
    },
  },
  defaultVariants: { size: 'section' },
});

export interface HeadlineProps extends VariantProps<typeof headlineVariants> {
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Headline({ as: Tag = 'h2', size, id, className, children }: HeadlineProps) {
  return (
    <Tag id={id} className={cn(headlineVariants({ size }), className)}>
      {children}
    </Tag>
  );
}
