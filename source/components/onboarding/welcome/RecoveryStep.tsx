'use client';

import { WalletExportIframe } from '@/components/listen/WalletExportIframe';
import { ArtFadeLoop } from './art/ArtFadeLoop';
import { KeyMini } from './art/key-mini';
import { WelcomePanel } from './WelcomePanel';
import s from './welcome.module.css';

/**
 * Onboarding step 1 — back up your recovery key, printed on the document.
 *
 * The reveal is the REAL Turnkey export iframe in its `document` chrome:
 * the plaintext mnemonic renders only inside the `export.turnkey.com`
 * origin, exactly as it does in the classic modal. Nothing here ever
 * renders words of its own — the redaction bar is six blurred slugs, and
 * on reveal the iframe takes that region over.
 *
 * Mandatory step: there is no skip, and Continue stays disabled until the
 * key has been revealed (or was backed up in a previous session).
 */
interface RecoveryStepProps {
  readonly walletAccountId: string | null;
  /** True once the key is revealed this session, or was already backed up. */
  readonly revealed: boolean;
  readonly onRevealed: () => void;
  readonly onContinue: () => void;
  /**
   * The wallet is not provisioned yet (arriving straight off redemption).
   * Holds the step in its pre-reveal shape with the bar as the status
   * surface; `useMe` already polls this state at ~1s, so it flips to the
   * real export region on its own the moment the wallet is ready.
   */
  readonly provisioning?: boolean;
  /**
   * Stand-in for the reveal region. The dev fixture passes an inert bar
   * so both states can be previewed without a Turnkey session (and
   * without ever printing words this app is not allowed to hold);
   * production leaves it undefined and gets the real export iframe.
   */
  readonly exportRegion?: React.ReactNode;
}

export function RecoveryStep({
  walletAccountId,
  revealed,
  onRevealed,
  onContinue,
  provisioning = false,
  exportRegion,
}: RecoveryStepProps): React.ReactElement {
  return (
    <WelcomePanel
      testId="welcome-step-recovery"
      eyebrow="STEP 1 OF 2 · WALLET SECURITY"
      headline="Back up your recovery key"
      headlineNarrow
      body="This is the only way to restore your wallet. Only you will ever see it."
      art={
        <ArtFadeLoop>
          <KeyMini size={140} />
        </ArtFadeLoop>
      }
    >
      <div className={s.revealRegion}>
        {provisioning ? (
          <ProvisioningHold />
        ) : (
          (exportRegion ?? (
            <WalletExportIframe
              walletAccountId={walletAccountId}
              prefetch
              appearance="document"
              onSuccess={onRevealed}
              hideLabel
              hideWarning
            />
          ))
        )}
      </div>

      {revealed ? (
        <p className={s.revealConfirm} data-testid="welcome-key-revealed">
          KEY REVEALED — STORE IT SOMEWHERE SAFE
        </p>
      ) : null}

      <div className={s.bottom}>
        {revealed ? null : (
          <p className={s.gateHint} data-testid="welcome-reveal-hint">
            REVEAL YOUR KEY TO CONTINUE
          </p>
        )}
        <div className={s.footer}>
          <p className={s.footerNote}>
            Secured by Turnkey. Revealed in a secure window, never shared with Listen.
          </p>
          <button
            type="button"
            data-testid="welcome-continue"
            className={s.continue}
            disabled={!revealed}
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </WelcomePanel>
  );
}

/**
 * The wallet is still being created. Same bar, same pill, no spinner — the
 * only difference a user sees is what the bar says, and the moment `/me`
 * reports the wallet ready this is replaced by the real export region in
 * place.
 */
function ProvisioningHold(): React.ReactElement {
  return (
    <div data-testid="welcome-provisioning-hold">
      <div className={s.holdBar}>
        <span className={s.holdStatus}>PROVISIONING YOUR VAULT…</span>
      </div>
      <button type="button" className={s.holdReveal} disabled>
        Reveal my key
      </button>
    </div>
  );
}
