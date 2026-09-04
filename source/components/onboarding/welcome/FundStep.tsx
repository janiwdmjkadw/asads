'use client';

import { useEffect, useState } from 'react';
import { ArtFadeLoop } from './art/ArtFadeLoop';
import { DepositWinner } from './art/deposit-winner';
import { WelcomePanel } from './WelcomePanel';
import { copyAddress } from './flow';
import s from './welcome.module.css';

/* QR encoder settings match `components/wallet/DepositAddress.tsx` — one
   behaviour for every deposit QR in the app. The colours are fixed here
   rather than read from the theme: this QR is printed on white paper, not
   on a themed surface. */
const QR_PIXELS = 126;
const QR_DARK = '#0B0E14';
const QR_LIGHT = '#FFFFFF';

/**
 * Onboarding step 2 — fund your wallet.
 *
 * Nothing on this step blocks anything: both the skip link and Continue
 * leave onboarding. The address is plain selectable text with an explicit
 * COPY button; clicking the box itself deliberately does NOT copy, so a
 * user checking the address against their wallet can select part of it.
 */
interface FundStepProps {
  readonly pubkey: string | null;
  readonly onSkip: () => void;
  readonly onContinue: () => void;
}

export function FundStep({ pubkey, onSkip, onContinue }: FundStepProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await copyAddress(
      pubkey,
      typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
    );
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <WelcomePanel
      testId="welcome-step-fund"
      eyebrow="STEP 2 OF 2 · ADD FUNDS"
      headline="Fund your wallet"
      body="Deposit SOL whenever you're ready — nothing blocks you from looking around first."
      /* On the same loop as step 1's key. Both steps are printed on one
         panel and sit in the same corner of it; one drawing arriving
         stroke by stroke and the other simply being there read as two
         different products. `ArtFadeLoop` writes the per-stroke delays
         once at mount and CSS owns every frame after that. */
      art={
        <ArtFadeLoop>
          <DepositWinner size={120} />
        </ArtFadeLoop>
      }
      artOffset="fund"
    >
      <div className={s.depositRow}>
        <DepositQr pubkey={pubkey} />
        <div className={s.addressBox}>
          <p className={s.addressLabel}>YOUR DEPOSIT ADDRESS</p>
          <p className={s.address} data-testid="welcome-deposit-address">
            {pubkey ?? 'Loading address…'}
          </p>
          <div className={s.copyRow}>
            <button
              type="button"
              data-testid="welcome-copy-address"
              className={s.copyButton}
              disabled={!pubkey}
              onClick={() => void handleCopy()}
            >
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>
        </div>
      </div>

      <div className={s.bottom}>
        <div className={s.footer}>
          <button type="button" data-testid="welcome-skip" className={s.skipLink} onClick={onSkip}>
            Skip for now — setup stays one click away in the navbar
          </button>
          <button
            type="button"
            data-testid="welcome-continue"
            className={s.continue}
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </WelcomePanel>
  );
}

function DepositQr({ pubkey }: { pubkey: string | null }): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    // Lazy so `qrcode` stays out of the shared bundle, as elsewhere.
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(pubkey, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: QR_PIXELS,
          color: { dark: QR_DARK, light: QR_LIGHT },
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  return (
    <div className={s.qrFrame}>
      {dataUrl ? (
        <img src={dataUrl} width={QR_PIXELS} height={QR_PIXELS} alt="Deposit address QR code" />
      ) : (
        <span className={s.qrPending}>GENERATING…</span>
      )}
    </div>
  );
}
