'use client';

import { useEffect } from 'react';
import { rememberTokenNavigationHint } from '@/components/listen/navigation';
import { setSolUsdHint } from '@/lib/state/sol-usd-hint';

/**
 * Seeds the sandbox's eight tape mints into the token hint memory.
 *
 * Any surface that shows a trade without owning the token's snapshot —
 * the tracker's wallet tape, the activity dock, the toasts — reads the
 * ticker out of `tokenTickerFromNavigationHint`, a per-browser memory
 * written when you navigate to a token or when the Discover feed scrolls
 * one past. In the sandbox neither has necessarily happened, so those
 * columns render "unknown" on a fresh profile and the row cannot be
 * looked at: a tape of trades with no token names on it is a list of
 * numbers.
 *
 * These are the same mints and symbols the mock API's own tape and
 * positions strip already use, so nothing here invents a coin — it only
 * tells the client what the mock backend already knows.
 *
 * It also seeds the SOL price. That hint is written by ONE thing — a
 * token snapshot landing on the trade page — so a session that opens
 * straight onto /tracker has no price, and every market cap in the tape
 * is computed as null and rendered as an em-dash.
 */
const SANDBOX_SOL_USD = 212;
const TOKENS: readonly { mint: string; symbol: string; name: string }[] = [
  { mint: 'HHaebZMt1xEGGb7jH8c3WydaaQQnJUWgAkPJuEffLtAB', symbol: 'WIF', name: 'dogwifhat' },
  { mint: 'sqPT6GMZDMa82QroHZ7siX7Xidnt8G3Nfog8fv9Pj12U', symbol: 'POPCAT', name: 'Popcat' },
  { mint: 's4b3FYYrLk68DrK5ftHcc6WcfyKrXHuxaFhPyRAB8MW8', symbol: 'FWOG', name: 'Fwog' },
  { mint: 'msDKBwPpurHXvq3Eb6vMtW3aVdXavX38qYhmVkVfDunh', symbol: 'GOAT', name: 'Goatseus Maximus' },
  { mint: 'xLdW17MK3VrQNMfwYbCEQvcmXkUVSaJTotpvU8vecfmE', symbol: 'PNUT', name: 'Peanut the Squirrel' },
  { mint: 'B8zcK6rVTcHmE9U6YCqFL6KVFXMbNY8BKnLvAX3MRMDi', symbol: 'MEW', name: 'cat in a dogs world' },
  { mint: 'ZXZHPtk7s8DUorm9skLVdyAnuEvCx2WpfyMaMtgJSmUT', symbol: 'ZEREBRO', name: 'Zerebro' },
  { mint: 'Jf1UFibrfKSj4ziR7YB4rxJxk5BsHYuxcnKSHeSS1zZx', symbol: 'MOODENG', name: 'Moo Deng' },
];

export function TokenHints(): null {
  useEffect(() => {
    setSolUsdHint(SANDBOX_SOL_USD);
    for (const t of TOKENS) {
      rememberTokenNavigationHint(t.mint, { symbol: t.symbol, name: t.name });
    }
  }, []);
  return null;
}
