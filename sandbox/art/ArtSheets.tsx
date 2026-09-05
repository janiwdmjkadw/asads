'use client';

/*
 * `/whatever` — the design route.
 *
 * The shipped `TerminalTopNav` and `AppSubHeader` on paper, and the
 * burger the bar opens. Both
 * are the real components with no override from this file: the glass
 * drawer you are looking at is `nav-drawer.css` itself, so what is here
 * is what the app has.
 *
 * The burger only exists below 800px, so open this narrow to reach it.
 */
import { DiscoverFeedProvider } from '@/components/discover/DiscoverFeedProvider';
import { WalletBalanceProvider } from '@/components/listen/WalletBalanceProvider';
import { AppSubHeader } from '@/components/listen/AppSubHeader';
import { TerminalTopNav } from '@/components/listen/TerminalTopNav';
import { AgentWalletSetupProvider } from '@/lib/agent-wallet-setup-context';
import { OnboardingProvider } from '@/lib/onboarding-context';

export function ArtSheets() {
  return (
    <DiscoverFeedProvider>
      <WalletBalanceProvider>
        <OnboardingProvider>
          <AgentWalletSetupProvider>
            <div className="flex min-h-screen flex-col bg-white">
              <TerminalTopNav />
              <AppSubHeader />
            </div>
          </AgentWalletSetupProvider>
        </OnboardingProvider>
      </WalletBalanceProvider>
    </DiscoverFeedProvider>
  );
}
