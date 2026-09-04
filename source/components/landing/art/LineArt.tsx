import type { ReactElement } from 'react';

import { ChartsArt } from './ChartsArt';
import { ConditionalsArt } from './ConditionalsArt';
import { DiscoverArt } from './DiscoverArt';
import { TrackingArt } from './TrackingArt';
import type { LineArtName, LineArtProps } from './types';

const ART = {
  discover: DiscoverArt,
  charts: ChartsArt,
  conditionals: ConditionalsArt,
  tracking: TrackingArt,
} as const satisfies Record<LineArtName, (props: LineArtProps) => ReactElement>;

export function LineArt({ name, ...props }: LineArtProps & { name: LineArtName }) {
  const Art = ART[name];
  return <Art {...props} />;
}
