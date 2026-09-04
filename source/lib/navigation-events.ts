export const TERMINAL_NAVIGATE_EVENT = 'terminal:navigate';
export const TERMINAL_PREFETCH_EVENT = 'terminal:prefetch';

export interface TerminalHrefDetail {
  href: string;
  warm?: boolean;
}

export type TerminalNavigateDetail = TerminalHrefDetail;
