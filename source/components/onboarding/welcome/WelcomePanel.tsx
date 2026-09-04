import type { ReactNode } from 'react';
import s from './welcome.module.css';

/**
 * The white document panel every step is printed on: one persistent
 * object on the ground, 640x560 on the boards, full-width and auto-height
 * on a phone.
 *
 * It is no longer onboarding's alone — the fren invite page is printed on
 * the same panel, so that a referred visitor and a new user are looking at
 * one product rather than two. That page passes `autoHeight`, and it is
 * the reason this file and the ground it sits on both want a home that is
 * not `onboarding/welcome/`.
 *
 * The artwork is positioned absolutely and deliberately breaks the 56px
 * content margin — per the boards its right edge sits 32px from the panel
 * edge, closer than any text ever gets.
 */
interface WelcomePanelProps {
  readonly eyebrow: string;
  /* A NODE, not a string. The fren invite sets the sender's handle and the
     verb under it at two different sizes inside one headline, which a
     string cannot express. Every onboarding step still passes a string. */
  readonly headline: ReactNode;
  /** Step 1's headline wraps to two lines in a 340px column; step 2's does not. */
  readonly headlineNarrow?: boolean;
  /** Let the panel grow past the board's 560px. The invite page mounts a
      sign up card inside it, which does not fit the fixed height. */
  readonly autoHeight?: boolean;
  readonly body: ReactNode;
  readonly art: ReactNode;
  readonly artOffset?: 'key' | 'fund';
  readonly testId: string;
  readonly children: ReactNode;
}

export function WelcomePanel({
  eyebrow,
  headline,
  headlineNarrow = false,
  autoHeight = false,
  body,
  art,
  artOffset = 'key',
  testId,
  children,
}: WelcomePanelProps): React.ReactElement {
  return (
    <section className={autoHeight ? `${s.panel} ${s.panelAuto}` : s.panel} data-testid={testId}>
      <div className={artOffset === 'fund' ? `${s.art} ${s.artFund}` : s.art}>{art}</div>
      <p className={s.eyebrow}>{eyebrow}</p>
      <h1 className={headlineNarrow ? `${s.headline} ${s.headlineWrap}` : s.headline}>
        {headline}
      </h1>
      <p className={s.body}>{body}</p>
      {children}
    </section>
  );
}
