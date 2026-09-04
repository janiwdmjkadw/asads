'use client';

import { useEffect, useState } from 'react';
import { Copy } from '@/components/listen/icons/Icons';

/**
 * Reusable Solana deposit-address view: QR + copyable address. Shared by
 * the onboarding deposit step and the navbar Deposit/Withdraw modal so
 * the QR generation + copy behaviour lives in one place.
 *
 * QR colours come from the theme-scoped `--qr-*` tokens (declared on
 * `.listen-root`, not `:root`), matching `WalletPanel`.
 */
interface DepositAddressProps {
  readonly pubkey: string | null;
  /** QR edge length in px. Defaults to 140. */
  readonly qrSize?: number;
  /**
   * Stretch to fill the parent's height: the QR centers in the available
   * space and the copyable address row pins to the bottom. Defaults to a
   * compact column (used by the onboarding deposit step).
   */
  readonly fill?: boolean;
}

export function DepositAddress({
  pubkey,
  qrSize = 140,
  fill = false,
}: DepositAddressProps): React.ReactElement {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pubkey) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const scope =
      (typeof document !== 'undefined'
        ? (document.querySelector('.listen-root') as HTMLElement | null)
        : null) ?? (typeof document !== 'undefined' ? document.documentElement : null);
    const computed = scope ? getComputedStyle(scope) : null;
    const dark = computed?.getPropertyValue('--qr-dark').trim() || '#0b0d12';
    const light = computed?.getPropertyValue('--qr-light').trim() || '#ffffff';
    // The encoder is lazy-loaded so `qrcode` stays out of the shell
    // bundle — it's only needed once a pubkey is actually rendered.
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(pubkey, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: qrSize,
          color: { dark, light },
        }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pubkey, qrSize]);

  async function handleCopy(): Promise<void> {
    if (!pubkey) return;
    try {
      await navigator.clipboard.writeText(pubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // best-effort
    }
  }

  const qr = qrDataUrl ? (
    <div className="rounded-xl border border-[var(--hairline-2)] bg-[var(--qr-light)] p-2.5">
      <img
        src={qrDataUrl}
        width={qrSize}
        height={qrSize}
        alt="Deposit address QR"
        className="block rounded-md"
      />
    </div>
  ) : (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-[var(--hairline-2)] bg-[var(--input-bg)] text-[12px] text-[var(--ink-3)]"
      style={{ width: qrSize + 20, height: qrSize + 20 }}
    >
      Generating address…
    </div>
  );

  const copyRow = (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={!pubkey}
      className="group flex w-full items-center gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--input-bg)] px-4 py-3 text-left transition-colors hover:border-[var(--hairline-2)] disabled:opacity-60"
    >
      <code
        data-deposit-address=""
        className="min-w-0 flex-1 break-all font-[family-name:var(--mono)] text-[12.5px] text-[var(--ink-1)]"
      >
        {pubkey ?? 'Loading address…'}
      </code>
      <span
        data-wallet-copy=""
        className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--accent-primary)]"
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );

  // Fill mode: QR centers in the available space, copy row pins to the bottom.
  if (fill) {
    return (
      <div className="flex w-full flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">{qr}</div>
        {copyRow}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {qr}
      {copyRow}
    </div>
  );
}
