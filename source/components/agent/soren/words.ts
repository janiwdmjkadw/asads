/**
 * The whimsy cycle's words (spec 30-creature §3.4).
 *
 * The gap is not silent and it is not a status readout: while nothing
 * truthful can be said — no tool is running — the whisper cycles synonyms
 * for thinking. The order is the spec's, and it is load-bearing: the words
 * advance one per think-beat of the wait cycle, so the same wait never
 * reads the same twice in a row.
 *
 * A running tool OVERRIDES all of this with its truthful verb (D7 · "03
 * THE VERB"); these words only ever fill the gaps between tools.
 */

export const WHIMSY_WORDS = [
  'pondering',
  'mulling it over',
  'ruminating',
  'percolating',
  'noodling',
  'scheming',
  'musing',
  'sleuthing',
] as const;

export type WhimsyWord = (typeof WHIMSY_WORDS)[number];

/**
 * The word for a think-beat. Beats only ever grow, so the modulo is what
 * makes the list a loop; negatives are folded back for safety rather than
 * returning `undefined` out of a hot render path.
 */
export function whimsyWordAt(beat: number): WhimsyWord {
  const n = WHIMSY_WORDS.length;
  const i = Math.trunc(beat) % n;
  return WHIMSY_WORDS[i < 0 ? i + n : i];
}
