import { cva, type VariantProps } from 'class-variance-authority';
import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* The CTA gradient runs at 90deg everywhere except the two small
   desktop chrome pills, which take 135deg — so the angle rides the size
   variant instead of being a separate knob callers can get wrong.

   The `desktop*` sizes label in Geist Mono (page chrome); `promo` and
   `hero` label in Geist (body voice, per B1/B2). */
const pillVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap font-geist-mono font-medium transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lp-accent focus-visible:ring-offset-2 focus-visible:ring-offset-lp-ground',
  {
    variants: {
      variant: {
        filled: 'text-lp-accent-ink',
        outlined: 'border border-lp-accent text-lp-accent',
      },
      size: {
        /* Header chrome pills. */
        desktop: 'h-[33px] min-w-[89px] rounded-full px-6 text-xs leading-[18px]',
        mobile: 'rounded-full px-[26px] py-3 text-sm leading-[18px]',
        /* B2 promo pill — desktop, sits in the copy column. */
        promo: 'rounded-full px-[26px] py-3 font-geist text-[15px] leading-[18px]',
        /* B1 hero CTA — the page's primary action. */
        hero: 'rounded-full px-[30px] py-3.5 font-geist text-[15px] leading-[18px]',
        /* B4 CTA — desktop-only markup, so no `lg:` step: Paper `DVX-0`
           labels the 44h shape in Geist 400 at 17/24. */
        infra: 'h-11 rounded-[36px] px-8 font-geist text-[17px] font-normal leading-6 tracking-[-0.25px]',
        /* B5 CTA — the mobile pill, grown into that same 44h shape at lg
           (Paper `7NE-1`, 16/24 400). */
        rewards:
          'rounded-full px-[26px] py-3 text-sm leading-[18px] lg:h-11 lg:rounded-[36px] lg:px-8 lg:py-0 lg:text-base lg:font-normal lg:leading-6 lg:tracking-[-0.25px]',
        /* B6 CTA — the mobile pill, shrunk to the chrome measures at lg.
           `lg:leading-[18px]` restates the line height `lg:text-xs` resets. */
        close:
          'rounded-full px-[26px] py-3 text-sm leading-[18px] lg:rounded-[27px] lg:px-6 lg:py-[7.5px] lg:text-xs lg:leading-[18px] lg:tracking-[-0.1875px]',
      },
    },
    compoundVariants: [
      { variant: 'filled', size: 'desktop', class: 'bg-lp-cta-diag' },
      {
        variant: 'filled',
        size: ['mobile', 'promo', 'hero', 'infra', 'rewards', 'close'],
        class: 'bg-lp-cta',
      },
    ],
    defaultVariants: { variant: 'filled', size: 'desktop' },
  },
);

export interface PillProps extends VariantProps<typeof pillVariants> {
  /** Renders an anchor when set, a button otherwise. */
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  className?: string;
  children: ReactNode;
}

export function Pill({ href, onClick, variant, size, className, children }: PillProps) {
  const classes = cn(pillVariants({ variant, size }), className);
  if (href) {
    return (
      <a href={href} onClick={onClick} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
