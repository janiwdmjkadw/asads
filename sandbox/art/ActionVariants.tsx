'use client';

import type { ReactNode } from 'react';
import { Clock, Solana } from '@/components/listen/icons/Icons';
import './action-variants.css';

/*
 * ── THE WALLETS TAB'S TOP RIGHT — FOUR WAYS ──────────────────────────
 *
 * History, Import, Create. They have been a row of three bordered
 * capsules, then a row of three plain words, then a row of three plain
 * words further apart, and the note every time has been the same: they
 * look bad. Respacing is not a fourth answer, so none of these four is
 * that.
 *
 * What is actually wrong is that three controls of equal weight are
 * sitting in the loudest slot on the page, and two of them are not the
 * same KIND of thing as the third. Create makes a wallet. History and
 * Import are somewhere to go. A row treats all three as peers, so the
 * eye has to sort them every time it lands there.
 *
 * Each variant below answers that differently:
 *
 *   1  Segmented   three cells in ONE object, so the group reads as one
 *                  control instead of three loose ones
 *   2  Overflow    two objects: the action, and a dot button holding
 *                  the other two
 *   3  Rail        no words at all, three glyph squares on one plate
 *   4  Divided     the two quiet ones, a real hairline, then the action
 *
 * They are shown on the tab's actual header row, with the left side
 * present, because this strip is judged by its balance against the
 * figure opposite it and not on its own.
 */

function Row({ n, name, note, children }: { n: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="av-slot">
      <div className="av-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="av-strip">
        <div className="av-left">
          <span className="av-count">3 wallets active</span>
          <span className="av-bal">
            <Solana style={{ width: 18, height: 18 }} />
            <span>41.28</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── 1 ── One object with three cells. */
function Segmented() {
  return (
    <div className="av-seg">
      <button type="button" className="av-seg-c">
        History
      </button>
      <button type="button" className="av-seg-c" disabled>
        Import
      </button>
      <button type="button" className="av-seg-c av-seg-go">
        Create
      </button>
    </div>
  );
}

/* ── 2 ── The action, and everything else behind one glyph. */
function Overflow() {
  return (
    <div className="av-of">
      <button type="button" className="av-dots" aria-label="More actions" title="History, Import">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      <button type="button" className="av-solid">
        Create
      </button>
    </div>
  );
}

/* ── 3 ── No words. Three squares on one plate. */
function Rail() {
  return (
    <div className="av-rail">
      <button type="button" className="av-sq" aria-label="Transfer history" title="Transfer history">
        <Clock style={{ width: 14, height: 14 }} />
      </button>
      <button type="button" className="av-sq" aria-label="Import a wallet" title="Import a wallet" disabled>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
      </button>
      <button type="button" className="av-sq av-sq-go" aria-label="Create a wallet" title="Create a wallet">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

/* ── 4 ── Words, a real rule, then the one solid thing. */
function Divided() {
  return (
    <div className="av-div">
      <button type="button" className="av-quiet">
        History
      </button>
      <button type="button" className="av-quiet" disabled>
        Import
      </button>
      <i className="av-rule" aria-hidden />
      <button type="button" className="av-solid">
        Create
      </button>
    </div>
  );
}

export function ActionVariants() {
  return (
    <div className="av">
      <h2>WALLETS TAB · THE TOP RIGHT, FOUR WAYS</h2>
      <p className="av-note">
        Three controls of equal weight in the loudest slot on the page, and two of them are not the
        same kind of thing as the third: Create makes a wallet, History and Import are somewhere to
        go. Every version so far has been a row of three peers, which is why respacing never fixed
        it. Each of these sorts them differently. Import is drawn disabled in all four, because it
        is.
      </p>

      <div className="av-stack">
        <Row n={1} name="Segmented" note="one object, three cells, the action lit">
          <Segmented />
        </Row>
        <Row n={2} name="Overflow" note="two objects; the quiet two live behind the dots">
          <Overflow />
        </Row>
        <Row n={3} name="Rail" note="no words, three squares on one plate">
          <Rail />
        </Row>
        <Row n={4} name="Divided" note="two words, a real rule, then the one solid thing">
          <Divided />
        </Row>
      </div>
    </div>
  );
}
