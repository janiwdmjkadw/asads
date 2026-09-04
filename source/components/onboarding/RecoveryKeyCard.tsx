'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Key, Shield, Eye } from '@/components/listen/icons/Icons';
import { WalletExportIframe } from '@/components/listen/WalletExportIframe';
import { SecuredByTurnkey } from './SecuredByTurnkey';
import { useMe } from '@/lib/api/me';
import { pickDefaultExportWallet } from '@/lib/auth/wallet-export';

/**
 * Onboarding step 1: recovery-key backup.
 *
 * Reuses the real Turnkey export iframe (`WalletExportIframe`) so the
 * reveal is functional end-to-end — the plaintext mnemonic renders
 * only inside the `export.turnkey.com` origin, never in the main app.
 * This card owns only the surrounding chrome (hero + trust copy); the
 * iframe's own label/warning are suppressed to avoid duplication.
 *
 * `onRevealed` fires once the mnemonic is successfully shown so the
 * parent modal can enable its `Next` control.
 */
interface RecoveryKeyCardProps {
  /** Called when the recovery key has been revealed inside the iframe. NO key material. */
  onRevealed: () => void;
}

export function RecoveryKeyCard({ onRevealed }: RecoveryKeyCardProps): React.ReactElement {
  const { data: me } = useMe();

  const walletAccountId = useMemo(() => {
    if (!me || me.reauth_required) return null;
    return pickDefaultExportWallet(me.wallets)?.wallet_account_id ?? null;
  }, [me]);

  return (
    <div className="flex flex-col items-center gap-7 text-center">
      {/* Accent key glyph with a gentle breathing glow behind it. */}
      <div className="relative flex items-center justify-center">
        <motion.span
          aria-hidden
          className="absolute h-20 w-20 rounded-full bg-[radial-gradient(circle,var(--accent-primary),transparent_70%)] blur-xl"
          animate={{ opacity: [0.35, 0.6, 0.35], scale: [0.9, 1.12, 0.9] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span
          aria-hidden
          className="relative flex h-20 w-20 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent-primary)_32%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]"
        >
          <Key className="h-9 w-9" strokeWidth={2} />
        </span>
      </div>

      {/* Action copy — plain, reassuring, non-custodial. */}
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-2xl font-semibold text-[var(--ink-0)]">
          Back up your recovery key
        </h2>
        <p className="m-0 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
          This is the only way to restore your wallet. Reveal it now and keep it somewhere
          safe. Only you will ever see it.
        </p>
      </div>

      {/* Reveal surface — the real export iframe, bare chrome. Axiom-style
          instant reveal: the ENCRYPTED bundle is prefetched as soon as the
          iframe keypair is warm, so the click is a local iframe decrypt
          instead of a multi-second Turnkey round trip. The main frame only
          ever holds ciphertext sealed to the iframe's embedded keypair —
          nothing decryptable leaks even under a same-origin script bug —
          and the mnemonic still renders ONLY on the explicit click. */}
      <div className="w-full text-left">
        <WalletExportIframe
          walletAccountId={walletAccountId}
          prefetch
          onSuccess={onRevealed}
          hideLabel
          hideWarning
        />
      </div>

      {/* Trust panel — headed by the Turnkey wordmark, then the
          plain-language assurances. */}
      <div className="flex w-full flex-col gap-5 overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--ink-0)_4%,transparent)] px-7 pt-5 pb-7 text-left">
        <SecuredByTurnkey className="h-6 w-auto self-center text-[var(--ink-1)]" />
        <div className="-mx-7 h-px bg-[var(--hairline)]" />
        <TrustRow icon={<Shield className="h-[18px] w-[18px]" />}>
          <span className="font-semibold text-[var(--ink-0)]">Listen never stores your keys.</span>{' '}
          They&apos;re held by Turnkey, never on our servers, so we can&apos;t access your funds.
        </TrustRow>
        <TrustRow icon={<Eye className="h-[18px] w-[18px]" />}>
          <span className="font-semibold text-[var(--ink-0)]">Only you can see it.</span> Your
          recovery key is revealed inside a secure Turnkey window, never shared with Listen.
        </TrustRow>
      </div>
    </div>
  );
}

function TrustRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--accent-primary)]">
        {icon}
      </span>
      <p className="m-0 text-[15px] leading-snug text-[var(--ink-1)]">{children}</p>
    </div>
  );
}
