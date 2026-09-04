/**
 * THE COLUMN, REMADE FROM THE REFERENCE. No `'use client'` on this file.
 *
 * A VALUE imported out of a `'use client'` module into a server component
 * arrives as a client reference proxy, so `.map` throws and the route
 * 500s. That has cost this project three 500s already.
 *
 * ── WHAT THE ROW HOLDS ───────────────────────────────────────────────
 *
 *   the art       56px, launchpad badge on one corner and a verified
 *                 tick on the other, the truncated mint under it
 *   line one      ticker, then the full name
 *   line two      age, then a run of inline marks — socials, holders,
 *                 comments, a bought/total ratio, watchers
 *   line three    the dev's handle and what else they have shipped
 *   line four     four risk pills: dev, top ten, snipers, insiders
 *   the right     volume over market cap, the fee, and a one-press buy
 *
 * Twenty-odd values in one row. It works because almost every metric is
 * an icon and a number rather than a labelled field.
 */

export type ColumnKind = 'default';
