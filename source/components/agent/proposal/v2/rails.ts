/**
 * The leg rail's hue — LEG IDENTITY, and nothing else.
 *
 * Rails are per leg and never appear inside one: no depth-coloured rails,
 * no buy/sell direction rail. The `LEG n` label wears the same value, so
 * the label and the rail state one thing together rather than competing.
 *
 * FOUR STOPS, CYCLED. Legs 5–8 repeat the cycle: the `LEG n` numeral
 * already carries absolute identity, so the hue only has to separate
 * neighbours. Eight distinguishable hues at matched chroma, clear of
 * green, red AND violet, do not exist — and violet is not negotiable,
 * because the grammar layer owns it (a lit `≥` beside a violet rail reads
 * as one signal, which is exactly the collision this ramp was re-picked
 * to avoid).
 *
 * THE MINT RULE IS IMPLEMENTED, NOT OPTIONAL. Three greens sit in one
 * card on purpose — the mint rail, the `BUY` word and value-box green —
 * and they only stay distinguishable while they are not adjacent. So when
 * leg 1's action is a BUY, the cycle starts one stop along and leg 1 takes
 * the sky: mint never sits beside the mint verb and the SOL mark inside
 * the same panel.
 */

/** `#79D8CA` mint-teal · `#B0D4E8` sky · `#DEBF8D` sand · `#EBB1CB` rose. */
export const RAIL_STOPS: readonly string[] = ['#79D8CA', '#B0D4E8', '#DEBF8D', '#EBB1CB'];

/**
 * The hue for a leg, by its ZERO-BASED index down the card.
 *
 * `leg1Buys` is read off the plan, not off this leg: the whole cycle
 * shifts, so leg 2 of a buying plan is sand rather than sky. Pure — the
 * card passes what it knows and this decides nothing else.
 */
export function railHueFor(legIndex: number, leg1Buys: boolean): string {
  const start = leg1Buys ? 1 : 0;
  const size = RAIL_STOPS.length;
  return RAIL_STOPS[(((start + legIndex) % size) + size) % size];
}
