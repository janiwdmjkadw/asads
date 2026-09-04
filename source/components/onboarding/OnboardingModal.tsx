'use client';

import { useEffect, useRef, useState } from 'react';
import { preconnect } from 'react-dom';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMe } from '@/lib/api/me';
import { persistRecoveryBackup } from '@/lib/onboarding/recovery-backup';
import { useOnboarding } from '@/lib/onboarding-context';
import { deriveWalletSetupStatus, markOnboardingSeen } from '@/lib/auth/onboarding-status';
import { pickDefaultExportWallet } from '@/lib/auth/wallet-export';
import {
  EXPORT_REVERIFICATION_EVENT,
  readExportReverificationActive,
} from '@/lib/wallet-export/exportReverification';

// Lazy card bodies: they pull framer-motion (+ the Turnkey export iframe
// chain) but only render once the modal is open — `OnboardingModal`
// returns null before that, so the chunk loads on first open instead of
// shipping in the shared shell bundle.
const RecoveryKeyCard = dynamic(
  () => import('./RecoveryKeyCard').then((m) => m.RecoveryKeyCard),
  { ssr: false },
);
const DepositCard = dynamic(() => import('./DepositCard').then((m) => m.DepositCard), {
  ssr: false,
});

/**
 * First-run onboarding modal.
 *
 * Forced surface: no close button, escape / outside-click dismissal is
 * suppressed. Open state is owned by `OnboardingProvider` so the navbar
 * "Finish Wallet Setup" button and the first-run auto-open gate share
 * one modal.
 *
 * Two steps:
 *   0. Recovery key — MANDATORY. Revealing it is the only way to advance
 *      (and persists the backup so re-opens skip straight to deposit).
 *   1. Deposit + nonce setup — optional; the user can "Finish later".
 */
const TOTAL_STEPS = 2;
const RECOVERY_STEP = 0;
const DEPOSIT_STEP = 1;

export function OnboardingModal(): React.ReactElement | null {
  const { open, closeOnboarding } = useOnboarding();
  const { getToken, userId } = useAuth();
  const { data: me } = useMe();
  const queryClient = useQueryClient();

  const { recoveryDone, tradingReady } = deriveWalletSetupStatus(me);

  const [step, setStep] = useState(RECOVERY_STEP);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const wasOpen = useRef(false);
  const warmedUp = useRef(false);

  // Recovery-key reveal can require a Clerk step-up, and Clerk mounts
  // that prompt on `document.body` — outside this dialog. While this
  // dialog is `modal`, Radix makes everything outside its own content
  // unclickable and untypeable, which left the prompt visible but dead.
  // Drop modality for exactly that window; Clerk's prompt carries its
  // own full-screen backdrop while it is up. See
  // `lib/wallet-export/exportReverification.ts`.
  const [reverifying, setReverifying] = useState(false);
  useEffect(() => {
    const onReverification = (event: Event) => {
      setReverifying(readExportReverificationActive(event));
    };
    window.addEventListener(EXPORT_REVERIFICATION_EVENT, onReverification);
    return () => window.removeEventListener(EXPORT_REVERIFICATION_EVENT, onReverification);
  }, []);

  // Warm the lazy path before the modal opens. The card bodies are
  // dynamic chunks (see above) and the recovery step boots the
  // export.turnkey.com iframe — for a fresh user the modal auto-opens
  // within seconds, so as soon as `/me` shows a wallet that still needs
  // setup we (a) prefetch both step chunks (no blank flash on open) and
  // (b) preconnect to the Turnkey export origin so the iframe's
  // DNS+TCP+TLS setup is already done when it mounts. Runs once; both
  // operations are cheap no-ops if the user never opens the modal.
  useEffect(() => {
    if (warmedUp.current) return;
    if (!me || me.reauth_required) return;
    if (deriveWalletSetupStatus(me).tradingReady) return;
    warmedUp.current = true;
    void import('./RecoveryKeyCard');
    void import('./DepositCard');
    preconnect('https://export.turnkey.com');
  }, [me]);

  // On each open transition, jump to the first incomplete step and reset
  // transient reveal state. If the recovery key is already backed up,
  // skip straight to the deposit step.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep(recoveryDone ? DEPOSIT_STEP : RECOVERY_STEP);
      setKeyRevealed(false);
    }
    wasOpen.current = open;
  }, [open, recoveryDone]);

  if (!open) return null;

  const isLastStep = step === TOTAL_STEPS - 1;
  // Recovery is mandatory: advance only once the key is revealed (this
  // session) or already backed up (a prior session). The deposit step is
  // always exitable via "Finish later".
  const recoveryGateOk = keyRevealed || recoveryDone;
  const stepGateOk = step === RECOVERY_STEP ? recoveryGateOk : true;
  const footerEnabled = isLastStep ? true : stepGateOk;
  const footerLabel = isLastStep ? (tradingReady ? 'Finish' : 'Finish later') : 'Next';

  function handleFooter(): void {
    if (isLastStep) {
      markOnboardingSeen(userId);
      closeOnboarding();
      return;
    }
    if (!stepGateOk) return;
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  async function handleRevealed(): Promise<void> {
    setKeyRevealed(true);
    if (recoveryDone) return;
    // Persist the backup so /me reflects a backed-up wallet and re-opens
    // skip the reveal step. Shared with the full-screen flow.
    const walletAccountId =
      me && !me.reauth_required
        ? (pickDefaultExportWallet(me.wallets)?.wallet_account_id ?? null)
        : null;
    if (await persistRecoveryBackup({ getToken, walletAccountId })) {
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
  }

  return (
    <Dialog open modal={!reverifying} onOpenChange={() => undefined}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className={cn(
          'w-[calc(100vw-2rem)] max-w-4xl gap-0 rounded-3xl p-8 sm:p-12',
          'border-[var(--hairline-2)] bg-[var(--surface-1)] shadow-[var(--shadow-modal)]',
        )}
      >
        <DialogTitle className="sr-only">Set up your wallet</DialogTitle>

        {/* Step body — shared min-height with vertically centered
            content so every step renders at a consistent size without
            an inner scrollbar. Steps are designed to fit this height. */}
        <div className="flex min-h-[600px] flex-col justify-center">
          {step === RECOVERY_STEP ? (
            // `handleRevealed` awaits getToken() + the backup-confirm
            // POST; an un-caught rejection here is an unhandled-
            // rejection crash class. Best-effort: the reveal already
            // happened client-side, and a missed server confirm only
            // re-forces the recovery step next session.
            <RecoveryKeyCard onRevealed={() => handleRevealed().catch(() => undefined)} />
          ) : (
            <DepositCard />
          )}
        </div>

        {/* Footer: contextual note left, centered dots, primary right.
            The button is ALWAYS the confident gradient — on the deposit
            step "Finish later" is the only pressable action here while
            the wallet is unfunded, so it must not read as a dim
            afterthought (it used to be a ghost, which made the step feel
            like a paywall). */}
        <div className="relative mt-10 flex items-center justify-end">
          {isLastStep && !tradingReady ? (
            <span className="mr-auto hidden text-[12.5px] text-[var(--ink-3)] sm:block">
              Setup stays one click away in the navbar.
            </span>
          ) : null}
          <StepDots total={TOTAL_STEPS} active={step} />
          <button
            type="button"
            data-testid="onboarding-next"
            onClick={handleFooter}
            disabled={!footerEnabled}
            className={cn(
              'rounded-full border border-[var(--hairline-2)] px-8 py-2.5 text-[15px] font-semibold transition-colors duration-150',
              'disabled:cursor-not-allowed disabled:opacity-40',
              // `--accent-ink`, not `--ink-0`: white on the accent gradient
              // measures ~1.3:1 on the default theme, which is what made
              // this button read as washed-out rather than confident.
              'text-[var(--accent-ink)] bg-[linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))]',
              'shadow-[0_6px_20px_-14px_var(--accent-secondary)]',
            )}
          >
            {footerLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepDots({ total, active }: { total: number; active: number }): React.ReactElement {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-[7px] rounded-full transition-all duration-200',
            i === active ? 'w-5 bg-[var(--accent-primary)]' : 'w-[7px] bg-[var(--hairline-2)]',
          )}
        />
      ))}
    </div>
  );
}
