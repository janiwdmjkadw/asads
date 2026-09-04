'use client';

/*
 * `/welcome` — the full-screen post-redemption onboarding.
 *
 * Its production route file is a server component that gates on auth; the
 * flow itself is the export's `WelcomeFlow`, and that is what renders here
 * by default.
 *
 * `?step=2` MOUNTS STEP 2 DIRECTLY, and it has to. `WelcomeFlow` starts on
 * the recovery step and only advances when the user reveals their key —
 * which goes through `export.turnkey.com`, the one part of this flow that
 * cannot exist in a sandbox. Without this, step 2 is unreachable and
 * therefore undesignable.
 *
 * It is the export's own `FundStep`, on the export's own ground, with the
 * two things a sandbox cannot supply passed in: a wallet address, and
 * handlers that would otherwise leave onboarding.
 *
 * The flow renders `null` while the `onboarding-fullscreen` flag is off, so
 * a blank page means exactly that: set the flag true in `sandbox/flags.ts`.
 */

import { useSearchParams } from 'next/navigation';
import { FundStep } from '@/components/onboarding/welcome/FundStep';
import { WelcomeBackground } from '@/components/onboarding/welcome/WelcomeBackground';
import { WelcomeFlow } from '@/components/onboarding/welcome/WelcomeFlow';
import s from '@/components/onboarding/welcome/welcome.module.css';

/** A real-shaped Solana address, so the box is the width it will be. */
const SANDBOX_PUBKEY = '7Xb4Qp2mKcVn8sRfT1yGh3JdLw6ZaEuN9kPvM5oCtBqA';

export function WelcomeClient() {
  const step = useSearchParams()?.get('step');

  if (step === '2') {
    return (
      <div className={s.page}>
        <WelcomeBackground />
        <FundStep pubkey={SANDBOX_PUBKEY} onSkip={() => {}} onContinue={() => {}} />
      </div>
    );
  }

  return <WelcomeFlow />;
}
