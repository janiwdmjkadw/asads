import type { CardSize, LayoutMode, SectionId } from '@/lib/state/discover-store';

/** Stack axis. Cards always flow PERPENDICULAR to this. */
export type Axis = 'vertical' | 'horizontal';

/** Which card component a panel renders. */
export type CardVariant = 'standard' | 'alpha';

/** A fixed panel takes its natural size (Alpha pinned in rows); a flex panel
 *  shares the remaining space proportionally and is resizable. */
export type PanelSizing = 'fixed' | 'flex';

/** A fully-resolved panel, ready for the engine to render uniformly. */
export interface ResolvedPanel {
  id: SectionId;
  label: string;
  variant: CardVariant;
  sizing: PanelSizing;
  /** Flex weight (flex panels only; 0 for fixed). */
  weight: number;
  /** Card-row tracks within this panel (1 or 2). */
  tracks: number;
}

/** Everything the dumb components need, derived from settings + measurement. */
export interface LayoutDescriptor {
  mode: LayoutMode;
  /** Stack axis: vertical for rows, horizontal for columns. */
  axis: Axis;
  /** Card flow axis (perpendicular to the stack). */
  cardFlow: Axis;
  cardSize: CardSize;
  panels: ResolvedPanel[];
}
