/**
 * THE LAUNCHPADS, WITH THEIR OWN ARTWORK.
 *
 * No `'use client'` on this file. A VALUE imported out of a `'use client'`
 * module into a server component arrives as a client reference proxy, so
 * `.map` throws and the route 500s. This list is read by the filters
 * modal and by the per-lane control, and it must stay importable by
 * either without knowing which side of the boundary the caller is on.
 *
 * The artwork is served from `public/assets/launchpads`, saved local so
 * nothing depends on those hosts at render time.
 *
 * ── ALL PNG, ALL TRANSPARENT ─────────────────────────────────────────
 *
 * Five of these shipped as `.ico`. A browser renders that format, but
 * nothing else in the toolchain does — sharp cannot open it, so the
 * artwork could not be checked, resized or cleaned, and those five were
 * the ones showing up as opaque squares with their own backgrounds.
 *
 * They are PNGs now, pulled out of the ico containers (an ico is a
 * wrapper around either a PNG or a headerless BMP), and every logo has
 * had its uniform background knocked out to transparency so the surface
 * behind it shows through instead.
 */

import type { ProtocolKey } from './discoverFilters';

const LOGOS = '/assets/launchpads';

export interface Launchpad {
  readonly key: ProtocolKey;
  readonly label: string;
  readonly logo: string;
}

export const LAUNCHPADS: readonly Launchpad[] = [
  { key: 'pumpfun', label: 'Pumpfun', logo: `${LOGOS}/pumpfun.png` },
  { key: 'bonk', label: 'Bonk', logo: `${LOGOS}/bonk.png` },
  { key: 'bags', label: 'Bags', logo: `${LOGOS}/bags.png` },
  { key: 'jupiter', label: 'Jupiter', logo: `${LOGOS}/jupiter.png` },
  { key: 'launchlab', label: 'LaunchLab', logo: `${LOGOS}/launchlab.png` },
  { key: 'heaven', label: 'Heaven', logo: `${LOGOS}/heaven.svg` },
  { key: 'moonshot', label: 'Moonshot', logo: `${LOGOS}/moonshot.png` },
  { key: 'boop', label: 'Boop', logo: `${LOGOS}/boop.png` },
  { key: 'believe', label: 'Believe', logo: `${LOGOS}/believe.png` },
  { key: 'moonit', label: 'Moonit', logo: `${LOGOS}/moonit.png` },
  { key: 'stonkfun', label: 'Stonkfun', logo: `${LOGOS}/stonkfun.png` },
  { key: 'trench', label: 'Tren.ch', logo: `${LOGOS}/trench.png` },
  { key: 'dynamicbc', label: 'Dynamic BC', logo: `${LOGOS}/dynamicbc.png` },
  { key: 'printr', label: 'PRINTR', logo: `${LOGOS}/printr.png` },
];
