'use client';

import { ArtSheets } from '../../../sandbox/art/ArtSheets';

/**
 * `/whatever` — the one page design work happens on. MOCKUPS ONLY.
 *
 * A shell. The composition — which sheets exist, in what order, with
 * what spacing — lives in `ArtSheets`, because that is design work and
 * this file is Next's: it carries the route and is the one most likely
 * to be regenerated or moved between route groups.
 */
export default function WhateverPage() {
  return <ArtSheets />;
}
