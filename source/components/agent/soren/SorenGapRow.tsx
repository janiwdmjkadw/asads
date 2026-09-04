'use client';

/**
 * The gap row — Soren in the in-between (spec 30-creature §3.2).
 *
 * THE ROW IS THE REPLY'S FIRST LINE BOX, not a row above it. It is an
 * explicit 22px flex line at the reply's left edge, `overflow: visible`,
 * carrying a 32px Soren (svg 32 × 30.4, so ≈4.2px of overhang top and
 * bottom, symmetrically) and the whisper 12px to his right. When the first
 * token lands the prose renders in the SAME slot of the SAME parent at
 * 15/22 — the box was already the right box, so nothing above or below
 * moves. The drawn version that gave the creature a row of its own
 * measured an 8.5px jump; removing that jump is the whole reason this
 * geometry exists.
 *
 * The handoff (§3.4, ≈420ms): at the first token the row is taken OUT OF
 * FLOW — the prose takes the flow slot immediately, still with no shift —
 * and Soren plays `slide-left` over it while the whisper fades with him.
 *
 * While the row is live, `waitCycle.ts` runs the beat table (§3.4) on the
 * creature's form channel, and the whisper carries either a running tool's
 * truthful verb or the whimsy words (D7).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ListenCreature,
  type FormName,
  type ListenCreatureHandle,
} from '@/components/creature/ListenCreature';
import { createWaitCycle, type WaitCycle } from './waitCycle';
import { whimsyWordAt } from './words';

/** The slide-left handoff (§3.4) — the row's life after the first token. */
export const HANDOFF_MS = 420;

/** The word roll (§3.4): old word rises 4px and fades, new fades in below. */
const ROLL_MS = 180;

/** Soren's measured gap size — the svg is then 32 × 30.4 (§3.2). */
const GAP_OWL_SIZE = 32;

export function SorenGapRow({
  verb,
  leaving = false,
}: {
  /**
   * The truthful whisper — a running tool's verb (`reading holders…`) or a
   * connection state (`sending…`). `null` hands the whisper to the whimsy
   * cycle and lets Soren wander through peek and head-turn.
   */
  verb: string | null;
  /** The first token has landed: vacate the box and slide left. */
  leaving?: boolean;
}) {
  const creature = useRef<ListenCreatureHandle | null>(null);
  const cycle = useRef<WaitCycle | null>(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (leaving) return;
    const wait = createWaitCycle({
      playForm: (form) => creature.current?.playForm(form),
      setWordBeat: setBeat,
    });
    cycle.current = wait;
    wait.start();
    return () => {
      wait.stop();
      cycle.current = null;
    };
  }, [leaving]);

  // The handoff. The cycle is already stopped by the cleanup above, so
  // nothing will start another form over the top of this one.
  useEffect(() => {
    if (!leaving) return;
    creature.current?.playForm('slide-left');
  }, [leaving]);

  // A running tool freezes the cycle on the dots: its verb owns the
  // whisper, and Soren must not wander off to peek mid-verb.
  useEffect(() => {
    cycle.current?.setHolding(verb !== null);
  }, [verb]);

  const onFormSettled = useCallback((form: FormName) => {
    cycle.current?.formSettled(form);
  }, []);

  const word = verb ?? whimsyWordAt(beat);
  const roll = useWordRoll(word);

  return (
    <div
      className={leaving ? 'ag-soren-gap ag-soren-gap--leaving' : 'ag-soren-gap'}
      data-testid="agent-soren-gap"
      data-leaving={leaving ? 'true' : undefined}
    >
      <ListenCreature
        ref={creature}
        size={GAP_OWL_SIZE}
        state="thinking"
        bodyColor="#DCD7E6"
        eyeColor="#0B0B0D"
        className="ag-soren-gap-owl"
        onFormSettled={onFormSettled}
      />
      {/* The whisper is decoration for a screen reader: it changes every
          beat and says nothing new each time. The one stable line below is
          what the surrounding polite region announces, once. */}
      <span aria-hidden className="ag-soren-whisper">
        {roll.out !== null ? (
          <span className="ag-soren-word ag-soren-word--out">{roll.out}</span>
        ) : null}
        <span key={roll.word} className="ag-soren-word ag-soren-word--in">
          {roll.word}
        </span>
      </span>
      <span className="sr-only">Soren is working</span>
    </div>
  );
}

/**
 * Keep the row mounted for the length of the handoff after it stops being
 * wanted, so the slide-left is actually seen. `leaving` is the flag that
 * takes it out of flow; `mounted` is what the caller renders on.
 */
export function useGapPresence(active: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(active);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, HANDOFF_MS);
    return () => window.clearTimeout(timer);
  }, [active, mounted]);

  return { mounted, leaving };
}

/**
 * The roll, as data: the word on screen plus the one still leaving. Two
 * nodes for 180ms, the outgoing one out of flow, then back to one — so the
 * animation is pure CSS (compositor-only transform/opacity) and the row's
 * geometry never depends on the word that is going away.
 */
function useWordRoll(word: string): { word: string; out: string | null } {
  const [roll, setRoll] = useState<{ word: string; out: string | null }>(() => ({
    word,
    out: null,
  }));
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (roll.word === word) return;
    setRoll({ word, out: roll.word });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setRoll((prev) => (prev.out === null ? prev : { ...prev, out: null }));
    }, ROLL_MS);
  }, [word, roll.word]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return roll;
}
