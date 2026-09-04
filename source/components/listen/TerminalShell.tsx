'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { DiscoverFeedProvider } from '@/components/discover/DiscoverFeedProvider';
import { PersistentDiscoverPane } from '@/components/discover/PersistentDiscoverPane';
import { PersistentTabPane } from '@/components/listen/PersistentTabPane';
import { TrackerPage } from '@/components/tracker/TrackerPage';
import { PortfolioPage } from '@/components/portfolio/PortfolioPage';
import { RewardsPage } from '@/components/rewards/RewardsPage';
import { TrackedWalletsProvider } from '@/components/discover/TrackedWalletsProvider';
import { TradeActivityProvider } from '@/components/trade-activity/TradeActivityProvider';
import { WalletProfileModal } from '@/components/wallet-profile/WalletProfileModal';
import { WalletSetupModalHost } from '@/components/portfolio/WalletSetupModalHost';
import { FlashModalHost } from '@/components/flash/FlashModalHost';
import { ChartAlertsWatcher } from '@/components/trade/ChartAlertsWatcher';
import { AgentChatDock } from '@/components/agent/AgentChatDock';
import { RedeemedCookieSync } from '@/components/auth/RedeemedCookieSync';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { AgentWalletSetupModal } from '@/components/agent-wallet/AgentWalletSetupModal';
import { PartnerWelcomeModal } from '@/components/rewards/PartnerWelcomeModal';
import { Toaster } from '@/components/ui/sonner';
import { useMe } from '@/lib/api/me';
import {
  deriveWalletSetupStatus,
  hasSeenOnboarding,
} from '@/lib/auth/onboarding-status';
import { WELCOME_PATH, decideOnboardingAutoOpen } from '@/lib/onboarding/auto-open';
import { useFullscreenOnboarding } from '@/lib/onboarding/useFullscreenOnboarding';
import { AgentWalletSetupProvider } from '@/lib/agent-wallet-setup-context';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding-context';
import { useSyncSelectedWallet } from '@/lib/state/selected-wallet-store';
import { useWalletPanel } from '@/lib/wallet-panel-context';
import { ThemeProvider } from './theme/ThemeProvider';
import { TerminalTopNav } from './TerminalTopNav';
import { AppPageBar } from './AppPageBar';
import { AppSubHeader } from './AppSubHeader';
import { AppFooter } from './AppFooter';
import { WalletBalanceProvider } from './WalletBalanceProvider';
import { WalletPanel } from './WalletPanel';

/**
 * Slice "Terminal wallet selector": invisible sync component
 * mounted once inside `TerminalShell`. It binds the selected-wallet
 * store to the active Clerk user and reconciles it against /me's
 * wallets list. Kept separate from `TerminalShell` so the hook is
 * exercised under `<WalletBalanceProvider>` (which itself reads
 * the selection).
 */
function SelectedWalletSync(): null {
  const { userId, isLoaded, isSignedIn } = useAuth();
  const { data: me } = useMe({ enabled: isSignedIn === true });
  const clerkUserId = isLoaded && isSignedIn === true ? (userId ?? null) : null;
  const wallets =
    me && !me.reauth_required ? me.wallets : null;
  useSyncSelectedWallet({ clerkUserId, wallets });
  return null;
}

/**
 * First-run auto-open. Opens the onboarding modal exactly once, when a
 * signed-in user (invite-code redemption is already enforced by the
 * terminal layout) has a provisioned-but-not-yet-ready wallet and has
 * not been shown onboarding before. After the wallet is `ready_to_trade`
 * or once dismissed, the navbar "Finish Wallet Setup" button is the
 * manual entry point.
 *
 * WHERE it opens depends on the `onboarding-fullscreen` LD flag: on, the
 * user lands on the full-screen `/welcome` route; off (and on every LD
 * hiccup — the hook fails closed), the classic modal opens exactly as it
 * always has.
 */
function OnboardingAutoOpen(): null {
  const { isSignedIn, userId } = useAuth();
  const { data: me } = useMe({ enabled: isSignedIn === true });
  const { openOnboarding } = useOnboarding();
  const router = useRouter();
  // Fails closed to the classic modal — see the hook.
  const fullscreenOnboarding = useFullscreenOnboarding();
  // Stores the user id we've already evaluated so a single account is
  // only auto-opened once — and a different account (same browser tab)
  // gets a fresh evaluation rather than inheriting the prior decision.
  const evaluatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (isSignedIn !== true || !userId) return;
    if (evaluatedFor.current === userId) return;

    const decision = decideOnboardingAutoOpen({
      status: deriveWalletSetupStatus(me),
      seen: hasSeenOnboarding(userId),
      fullscreen: fullscreenOnboarding,
    });
    // `wait` = undecidable yet (no /me, or the wallet is still
    // provisioning): re-evaluate on the next tick rather than locking in
    // a "no-open" decision.
    if (decision === 'wait') return;
    evaluatedFor.current = userId;
    if (decision === 'modal') openOnboarding();
    if (decision === 'welcome') router.push(WELCOME_PATH);
  }, [isSignedIn, userId, me, openOnboarding, router, fullscreenOnboarding]);

  return null;
}

/**
 * The shell's modal open-state contexts, composed into one wrapper so the
 * provider pyramid stops growing a level per modal. Both are plain
 * open/close contexts with a no-op fallback; neither fetches.
 */
function ShellModalProviders({ children }: { children: ReactNode }) {
  return (
    <OnboardingProvider>
      <AgentWalletSetupProvider>{children}</AgentWalletSetupProvider>
    </OnboardingProvider>
  );
}

export function TerminalShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TrackedWalletsProvider>
        <DiscoverFeedProvider>
          <SelectedWalletSync />
          <WalletBalanceProvider>
            <ShellModalProviders>
              <div className="relative z-[1] flex flex-col flex-1 min-h-screen">
                <TerminalTopNav />
                <AppSubHeader />
                <AppPageBar />
                {/* flex-1 wrapper keeps the footer pinned to the bottom on
                    short pages; viewport-locked pages size themselves to
                    --h-app-content and fill it exactly. */}
                {/* Discover AND Trade live HERE as persistent panes
                    (lazy-mounted, display:none on other routes) so switching
                    between them never tears down or remounts either side.
                    Their route pages render null. */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <PersistentDiscoverPane />
                  {/*
                    ── THE TRADE SURFACE IS GONE ────────────────────────
                    `PersistentTradePane` and `PersistentEvmTradePane`
                    used to mount here beside Discover. The trade page is
                    being rebuilt from nothing, so both are unmounted and
                    `/trade` renders the shell alone — top nav, positions
                    strip, footer — with an empty stage between them.

                    The components are untouched on disk. Putting the old
                    surface back is re-adding these two lines, which is
                    why they are commented rather than deleted:

                      <PersistentTradePane />
                      {useEvmEnabled() ? <PersistentEvmTradePane /> : null}
                  */}
                  {/* Simple tabs get the same treatment (field nav-beacons
                      measured 500–2000ms mount-bound switches): first visit
                      mounts, later switches are display flips. Their route
                      pages render null. Frens keeps its route mount — its
                      assemble-on-mount art is intentional. */}
                  <PersistentTabPane prefix="/tracker">
                    <TrackerPage />
                  </PersistentTabPane>
                  <PersistentTabPane prefix="/portfolio">
                    <PortfolioPage />
                  </PersistentTabPane>
                  <PersistentTabPane prefix="/rewards">
                    <RewardsPage />
                  </PersistentTabPane>
                  {children}
                </div>
                <AppFooter />
              </div>

              {/* Caches the monotonic invite-code "redeemed" check in a
                  signed cookie so the layout stops re-hitting the api on
                  every refresh (set once per session). */}
              <RedeemedCookieSync />

              {/* Singleton SSE listener + global top-of-screen toast
                  stack + one-shot api/ cache warmup on sign-in. */}
              <TradeActivityProvider />

              {/*
               * The deposit / wallet management modal. MUST live inside
               * `<ThemeProvider/>` (i.e. inside `.listen-root`) so the
               * modal sees theme-scoped CSS variables (--surface-1,
               * --ink-*, --accent-*). Was previously mounted at the
               * app providers level — outside listen-root — which is
               * why the modal rendered with the global dark defaults
               * even under the zen parchment theme.
               */}
              <GlobalWalletPanel />

              {/* First-run onboarding: auto-opens once, re-openable from
                  the navbar "Finish Wallet Setup" button. */}
              <OnboardingAutoOpen />
              <OnboardingModal />
              {/* Agent-wallet setup: never auto-opens, only from the
                  navbar "Set up agent wallet" chip. */}
              <AgentWalletSetupModal />
              {/* One-time gilded owl welcome for newly activated partners
                  (rides the shared notifications poll; renders nothing
                  until an unseen partner_welcome row appears). */}
              <PartnerWelcomeModal />
              {/* Address dossier: any clicked wallet address anywhere opens
                  this single instance via openWalletProfile(). */}
              <WalletProfileModal />
              <WalletSetupModalHost />
              {/* Flash: any bolt anywhere opens this single instance via
                  openFlash(walletAccountId). */}
              <FlashModalHost />
              {/* Cross-page watcher for armed chart price alerts (rich
                  clickable toasts with the coin's image + ticker). */}
              <ChartAlertsWatcher />
              {/* Agent chat (feature-flagged): renders null unless
                  NEXT_PUBLIC_AGENT_CHAT=1; chat code stays in its own
                  async chunks (see AgentChatDock). */}
              <AgentChatDock />
              <Toaster position="top-right" />
            </ShellModalProviders>
          </WalletBalanceProvider>
        </DiscoverFeedProvider>
      </TrackedWalletsProvider>
    </ThemeProvider>
  );
}

function GlobalWalletPanel(): React.ReactElement {
  const { open, closeWalletPanel } = useWalletPanel();
  return <WalletPanel open={open} onClose={closeWalletPanel} />;
}
