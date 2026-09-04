import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* Tracking and size are the two things that separate the desktop and
   mobile anchors (1440 / 390); everything else about an eyebrow is
   constant across the page. */
const eyebrowVariants = cva('font-geist-mono font-medium uppercase', {
  variants: {
    size: {
      desktop: 'text-[13px] leading-4 tracking-[0.1em]',
      mobile: 'text-[11px] leading-4 tracking-[0.18em]',
      /* B2 — the larger label above a section headline. */
      lg: 'text-[14px] leading-[18px] tracking-[0.08em]',
      /* B1 — reads as a sentence, not a label: no caps, no tracking. */
      display: 'text-[18px] leading-[22px] normal-case tracking-normal',
    },
    tone: {
      ink2: 'text-lp-ink-2',
      ink3: 'text-lp-ink-3',
      accent: 'text-lp-accent',
      mint: 'text-lp-mint',
      /* On the light tiles the eyebrow inverts onto the dark ink. */
      dark: 'text-lp-accent-ink',
    },
  },
  defaultVariants: { size: 'desktop', tone: 'ink2' },
});

export interface EyebrowProps extends VariantProps<typeof eyebrowVariants> {
  className?: string;
  children: ReactNode;
}

export function Eyebrow({ size, tone, className, children }: EyebrowProps) {
  return <p className={cn(eyebrowVariants({ size, tone }), className)}>{children}</p>;
}
