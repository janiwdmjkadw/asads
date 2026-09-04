'use client';

/*
 * ── YOUR FRENS, EMPTY ────────────────────────────────────────────────
 *
 * The two states as they are actually shipped. This imports the REAL
 * stylesheet and uses the real class names rather than a copy, so what
 * is on this page is what is on the tab — a mockup of a shipped thing
 * that drifts from it is worse than no mockup.
 *
 * The only thing invented here is the data, because the fixture has
 * nine frens in it and neither state can be reached without emptying
 * it.
 */

import '@/components/rewards/fren-board.css';
import './fren-empty-sheet.css';

function Frame({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <div className="fes-slot">
      <div className="fes-cap">
        <b>{name}</b>
        <small>{note}</small>
      </div>
      <div className="fes-frame">
        <div className="fes-sec">
          Your frens<small>Weekly</small>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FrenEmptySheet() {
  return (
    <div className="fes">
      <h2>REFERRAL · YOUR FRENS, EMPTY</h2>
      <p className="fes-note">
        Both states as shipped, using the real stylesheet and the real class names. The mark is the
        owl every fren in this list carries, drawn once and held right back: an empty board is one
        of those with nobody in it. It sits exactly where the top fren&apos;s medal sits, so the
        section does not move the day somebody arrives.
      </p>

      <div className="fes-stack">
        <Frame name="No frens yet" note="totalCount is 0 — the link has not worked, or has not been sent">
          <div className="frb-none">
            <span className="frb-owl frb-owl-lg frb-owl-ghost" aria-hidden />
            <div>
              <b>No frens yet</b>
              <p>
                Anyone who joins through your link is yours, and you earn on every trade they ever
                make. It does not expire and it does not cap.
              </p>
            </div>
          </div>
        </Frame>

        <Frame name="Nobody traded this week" note="totalCount is 14 — the link worked fine, the window is quiet">
          <div className="frb-none">
            <span className="frb-owl frb-owl-lg frb-owl-ghost" aria-hidden />
            <div>
              <b>Nobody traded this week</b>
              <p>
                You have 14 frens, and none of them traded in this window. Try a longer one.
              </p>
            </div>
          </div>
        </Frame>

        <Frame name="For comparison" note="the same section with frens in it">
          <div className="frb">
            <div className="frb-top">
              <span className="frb-lab">Top fren, weekly</span>
              <div className="frb-medal">
                <span
                  className="frb-owl frb-owl-lg"
                  aria-hidden
                  style={{
                    background:
                      'linear-gradient(145deg, #3d6d96 0%, #8ec6e8 27%, #e8f7ff 45%, #6fa9d2 68%, #315a80 100%)',
                  }}
                />
                <div>
                  <div className="frb-top-nm">@aster</div>
                  <div className="frb-top-e">
                    2.7000<span className="frb-top-u">SOL to you</span>
                  </div>
                  <span className="frb-metal">Platinum</span>
                </div>
              </div>
              <span className="frb-dim">from 920.00 SOL traded</span>
            </div>
            <div className="frb-list">
              {[
                ['02', 'brixby', '1.4000', 3],
                ['03', 'you', '0.9667', 2],
                ['04', 'delune', '0.7500', 2],
              ].map(([r, w, e, m]) => (
                <div className="frb-row" key={w as string}>
                  <span className="frb-rk">{r}</span>
                  <span
                    className="frb-owl"
                    aria-hidden
                    style={{
                      background: [
                        'linear-gradient(145deg, #3f454b 0%, #7d858d 34%, #aab2ba 48%, #6c747c 64%, #383d43 100%)',
                        'linear-gradient(145deg, #5e3115 0%, #a9642f 32%, #e0a066 47%, #96552a 66%, #4d2711 100%)',
                        'linear-gradient(145deg, #6c737c 0%, #c2c9d1 30%, #f4f7fa 46%, #a8b0b9 66%, #5f666e 100%)',
                        'linear-gradient(145deg, #7a5408 0%, #d3a72c 30%, #f7dd8a 46%, #c09220 66%, #6b4806 100%)',
                      ][m as number],
                    }}
                  />
                  <span className="frb-nm">@{w}</span>
                  <span className="frb-num">{e}</span>
                </div>
              ))}
            </div>
          </div>
        </Frame>
      </div>
    </div>
  );
}
