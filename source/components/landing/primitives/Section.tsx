import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ContainerProps {
  className?: string;
  children: ReactNode;
}

/** The 1440-wide content column: centred, full-width below the cap. */
export function Container({ className, children }: ContainerProps) {
  return <div className={cn('mx-auto w-full max-w-[var(--lp-container)]', className)}>{children}</div>;
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Background layer — painted full-bleed behind the content column. */
  bleed?: ReactNode;
  containerClassName?: string;
  children: ReactNode;
}

/**
 * One band of the page: a full-bleed background with the capped content
 * column centred on top of it. `bleed` renders into an absolutely
 * positioned, non-interactive layer so backgrounds (video, shader, plate)
 * stay edge-to-edge while the content stops at `--lp-container`.
 */
export function Section({ bleed, className, containerClassName, children, ...rest }: SectionProps) {
  return (
    <section className={cn('relative isolate w-full overflow-hidden', className)} {...rest}>
      {bleed ? <div className="pointer-events-none absolute inset-0 -z-10">{bleed}</div> : null}
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}
