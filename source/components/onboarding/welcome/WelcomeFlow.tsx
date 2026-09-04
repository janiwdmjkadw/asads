'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/lib/api/me';
import { deriveWalletSetupStatus } from '@/lib/auth/onboarding-status';
import { pickDefaultExportWallet, pickPrimaryWalletEntry } from '@/lib/auth/wallet-export';
import { useFullscreenOnboarding } from '@/lib/onboarding/useFullscreenOnboarding';
import { persistRecoveryBackup } from '@/lib/onboarding/recovery-backup';
import { FundStep } from './FundStep';
import { RecoveryStep } from './RecoveryStep';
import { WelcomeBackground } from './WelcomeBackground';
import { useDepositWatch } from './useDepositWatch';
import {
  DEPOSIT_STEP,
  RECOVERY_STEP,
  canContinueFromRecovery,
  leaveOnboarding,
  type WelcomeStep,
} from './flow';
import s from './welcome.module.css';

/**
 * The full-screen post-redemption onboarding: two steps printed on one
 * white document over a live mesh ground.
 *
 * Flag gate. `onboarding-fullscreen` is a LaunchDarkly flag, so it is not
 * knowable on the server — the route's server layout gates auth only and
 * this client child gates the flag. It renders `null` rather than
 * `notFound()`/redirecting because `useFlags()` reads `{}` until the LD
 * client initializes: bouncing on that first render would throw entitled
 * users off their own onboarding a frame before LD answers. Users without
 * the flag never see a link here — both entry points (auto-open, navbar)
 * check the same flag and open the classic modal instead.
 */
export function WelcomeFlow(): React.ReactElement | null {
  const fullscreenOnboarding = useFullscreenOnboarding();
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const { data: me } = useMe();
  const queryClient = useQueryClient();

  const { provisioned, recoveryDone } = deriveWalletSetupStatus(me);
  const wallet = useMemo(() => {
    if (!me || me.reauth_required) return null;
    return pickPrimaryWalletEntry(me.wallets) ?? pickDefaultExportWallet(me.wallets);
  }, [me]);
  const exportWalletAccountId = useMemo(() => {
    if (!me || me.reauth_required) return null;
    return pickDefaultExportWallet(me.wallets)?.wallet_account_id ?? null;
  }, [me]);

  const [step, setStep] = useState<WelcomeStep>(RECOVERY_STEP);
  const [keyRevealed, setKeyRevealed] = useState(false);
  // The step is only auto-selected once, on the first settled `/me`;
  // after that the user's own Continue owns it.
  const stepChosen = useRef(false);

  useDepositWatch({
    walletAccountId: wallet?.wallet_account_id ?? null,
    nonceRequired: wallet?.nonce_setup.required ?? false,
  });

  useEffect(() => {
    if (stepChosen.current || !me) return;
    stepChosen.current = true;
    if (recoveryDone) setStep(DEPOSIT_STEP);
  }, [me, recoveryDone]);

  if (!fullscreenOnboarding) return null;

  const revealed = canContinueFromRecovery({ keyRevealed, recoveryDone });

  async function handleRevealed(): Promise<void> {
    setKeyRevealed(true);
    if (recoveryDone) return;
    if (await persistRecoveryBackup({ getToken, walletAccountId: exportWalletAccountId })) {
      await queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
  }

  function handleExit(): void {
    leaveOnboarding(userId, (path) => router.replace(path));
  }

  return (
    <div className={s.page}>
      <WelcomeBackground />
      {step === RECOVERY_STEP ? (
        <RecoveryStep
          walletAccountId={exportWalletAccountId}
          revealed={revealed}
          // Redemption now lands here directly, so the wallet is often
          // still being created. `provisioned` is false while `/me` is
          // in flight too, which is the right default: hold rather than
          // flash a Reveal button that has nothing to export. `useMe`
          // polls the pending provisioning states itself, so the hold
          // resolves without any timer of ours.
          provisioning={!provisioned}
          // `handleRevealed` awaits getToken() + the backup-confirm POST;
          // an un-caught rejection here is an unhandled-rejection crash
          // class. Best-effort: the reveal already happened client-side,
          // and a missed server confirm only re-forces this step next
          // session.
          onRevealed={() => handleRevealed().catch(() => undefined)}
          onContinue={() => setStep(DEPOSIT_STEP)}
        />
      ) : (
        <FundStep
          pubkey={wallet?.wallet_pubkey ?? null}
          onSkip={handleExit}
          onContinue={handleExit}
        />
      )}
    </div>
  );
}
