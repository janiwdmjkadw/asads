import type { ReactElement } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Tooltip shown above a quick-amount chip on hover (the "Est.
 * receive: X SOL" / "Sell ~N tokens" hints), shared by the TradePanel
 * and the Instant Trade box. Wrap the chip: the content renders
 * through the Radix portal, so it escapes the panels' `overflow:
 * hidden` (and the instant box's zoom wrapper) instead of getting
 * clipped at their edges, and flips/shifts away from viewport edges.
 */
export function HoverPreview({
  label,
  children,
}: {
  label?: string;
  children: ReactElement;
}): ReactElement {
  if (!label) return children;
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-[280px] rounded px-2.5 py-1.5 text-[11px] leading-snug [font-family:var(--mono)]"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
