/*
 * Server safe. NO `'use client'` — `/whatever` is a server component and
 * maps over this.
 *
 * ONE head, copied from the reference:
 *
 *   New . . . Search . . . ⚡ 0 ◎  P1 [chart]  [filter]
 *
 * Everything the reference has except the audio control, which is out on
 * request. No rows, no tokens, no prices.
 */

export const TOP_KINDS = ['padre'] as const;

export type TopKind = (typeof TOP_KINDS)[number];
