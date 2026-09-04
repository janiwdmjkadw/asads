'use client';

import type { ReactNode } from 'react';
import './fren-empty-variants.css';

/*
 * ── REFERRAL · YOUR FRENS, WITH NO FRENS ─────────────────────────────
 *
 * What is there now is one grey sentence where the whole section used
 * to be: `No referral activity in this window yet.` On a tab that has
 * just given the top half to a link nobody has used, that is the second
 * dead block in a row.
 *
 * ── THERE ARE TWO EMPTY STATES AND THE CODE ONLY HAS ONE ─────────────
 *
 * NOBODY HAS JOINED. You have never had a fren. The link has not worked
 * yet, or you have not sent it.
 *
 * NOBODY TRADED. You have fourteen frens and none of them traded this
 * week. The link worked fine.
 *
 * They are completely different situations and one sentence covers
 * both, so the person with fourteen quiet frens is told they have no
 * referral activity and the person with none is told the same. The
 * component already knows which is which — `totalCount` is a prop and
 * it is either zero or it is not.
 *
 *   1  Now       what ships
 *   2  Ask       the empty half becomes the invite
 *   3  Worth     what a fren is actually worth, in figures
 *   4  Shape     a ghost of the board, so you can see what appears
 */

function Slot({ i, name, note, children }: { i: number; name: string; note: string; children: ReactNode }) {
  return (
    <div className="fe-slot">
      <div className="fe-cap">
        <b>
          {i}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className="fe-frame">
        <div className="fe-sec">Your frens</div>
        {children}
      </div>
    </div>
  );
}

/* ── 1 ── NOW ─────────────────────────────────────────────────────── */
function Now() {
  return <p className="fe-line">No referral activity in this window yet.</p>;
}

/* ── 2 ── ASK ─────────────────────────────────────────────────────────
 * The section has nothing to list, so it asks for the one thing that
 * would fill it. The link is already at the top of the tab, but at the
 * moment somebody reads THIS block they have just learned they have no
 * frens, and that is the moment the ask lands. */
function Ask() {
  return (
    <div className="fe-ask">
      <b>No frens yet</b>
      <p>
        Anyone who joins through your link is yours, and you earn on every trade they ever make. It
        does not expire and it does not cap.
      </p>
      <button type="button" className="fe-go">
        Copy your link
      </button>
    </div>
  );
}

/* ── 3 ── WORTH ───────────────────────────────────────────────────────
 * The figures a fren is actually worth, so the empty state is doing the
 * arithmetic the reader would otherwise have to. `30% of the 1% fee` is
 * a true sentence that means nothing until somebody turns it into SOL.
 *
 * The example is labelled as one. A worked example presented as a
 * forecast is a promise the product cannot keep. */
function Worth() {
  return (
    <div className="fe-worth">
      <b>No frens yet</b>
      <div className="fe-figs">
        <span>
          <i>You keep</i>
          <b>30%</b>
          <u>of the 1% fee</u>
        </span>
        <span>
          <i>A fren trading 100 SOL a week</i>
          <b>0.30 SOL</b>
          <u>to you, every week</u>
        </span>
        <span>
          <i>Ten of them</i>
          <b>3.00 SOL</b>
          <u>a week, for as long as they trade</u>
        </span>
      </div>
      <p className="fe-eg">An example, not a forecast. What you earn is whatever they trade.</p>
      <button type="button" className="fe-go">
        Copy your link
      </button>
    </div>
  );
}

/* ── 4 ── SHAPE ───────────────────────────────────────────────────────
 * A ghost of the board that will be here. It answers `what goes in this
 * space` without pretending to have data, and it keeps the section the
 * same height whether it is full or not, so the page does not jump the
 * day the first fren arrives.
 *
 * The risk: a skeleton that never resolves reads as a page still
 * loading, which is why it carries a real sentence over the top. */
function Shape() {
  return (
    <div className="fe-shape">
      <div className="fe-ghost" aria-hidden>
        <div className="fe-ghost-top">
          <span className="fe-ghost-owl" />
          <span>
            <i style={{ width: 96 }} />
            <i style={{ width: 140, height: 26 }} />
          </span>
        </div>
        <div className="fe-ghost-list">
          {[1, 0.86, 0.72, 0.6].map((w, k) => (
            <span key={k}>
              <em />
              <i style={{ width: `${w * 58}%` }} />
              <u />
            </span>
          ))}
        </div>
      </div>
      <div className="fe-over">
        <b>No frens yet</b>
        <p>Your frens and what they earn you will show up here.</p>
        <button type="button" className="fe-go">
          Copy your link
        </button>
      </div>
    </div>
  );
}

export function FrenEmptyVariants() {
  return (
    <div className="fe">
      <h2>REFERRAL · YOUR FRENS, WITH NO FRENS</h2>
      <p className="fe-note">
        What ships is one grey sentence where the section used to be, on a tab that has just given
        its top half to a link nobody has used. Second dead block in a row.
      </p>
      <p className="fe-note">
        There are also two empty states and the code has one. Nobody has JOINED is not the same as
        nobody TRADED this week: the person with fourteen quiet frens and the person with none get
        the same sentence. The component already knows which is which, because `totalCount` is
        either zero or it is not.
      </p>

      <div className="fe-stack">
        <Slot i={1} name="Now" note="what ships">
          <Now />
        </Slot>
        <Slot i={2} name="Ask" note="the empty half becomes the invite">
          <Ask />
        </Slot>
        <Slot i={3} name="Worth" note="what a fren is actually worth, in figures">
          <Worth />
        </Slot>
        <Slot i={4} name="Shape" note="a ghost of the board, so you can see what appears">
          <Shape />
        </Slot>
      </div>

      <div className="fe-second">
        <div className="fe-cap">
          <b>And the other one</b>
          <small>fourteen frens, none of them traded this week</small>
        </div>
        <div className="fe-frame">
          <div className="fe-sec">
            Your frens<small>Weekly</small>
          </div>
          <div className="fe-ask">
            <b>Nobody traded this week</b>
            <p>
              You have 14 frens and they have earned you 12.6 SOL all time. Switch to Lifetime to
              see them.
            </p>
            <div className="fe-win">
              <button type="button">Daily</button>
              <button type="button" data-on>
                Weekly
              </button>
              <button type="button">Monthly</button>
              <button type="button">Lifetime</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
