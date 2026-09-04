'use client';

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  coldBootRetry,
  throwOnColdBootReauth,
  withColdBootAuth,
} from '@/lib/api/cold-boot-auth';
import { fetchSpot, type SpotHolding, type SpotResult } from '@/lib/api/portfolio-spot';
import { useTradePaneHidden } from '../tradePaneVisibility';
import { PAGE_MINT_DECIMALS, SOL_DECIMALS, SOL_MINT, USDC_DECIMALS, USDC_MINT } from './math';

/**
 * Wallet-holdings feed for the Allocate/Pay pickers on the Advanced +
 * Limit tabs. Wraps `GET /api/v1/portfolio/spot` (scoped to the
 * selected wallet) in react-query with the SAME query key SpotTab uses,
 * so the two surfaces share one cache entry instead of double-polling.
 */

const SPOT_REFETCH_MS = 15_000;

/** One pickable token in the Allocate/Pay/Receive dropdowns. */
export interface TokenOption {
  readonly mint: string;
  readonly symbol: string;
  readonly name: string | null;
  readonly logo: string | null;
  readonly decimals: number;
  /** Integer base units held in the selected wallet; null = unknown. */
  readonly balanceBaseUnits: string | null;
  readonly balanceUi: number | null;
  readonly valueUsd: number | null;
  readonly priceUsd: number | null;
}

export interface SpotHoldingsState {
  readonly options: ReadonlyArray<TokenOption>;
  readonly solPriceUsd: number | null;
  readonly loading: boolean;
}

function holdingToOption(h: SpotHolding, fallbackSymbol: string): TokenOption {
  return {
    mint: h.mint,
    symbol: h.symbol ?? fallbackSymbol,
    name: h.name,
    logo: h.logo,
    decimals: h.decimals,
    balanceBaseUnits: h.amount_raw,
    balanceUi: h.amount_ui,
    valueUsd: h.value_usd,
    priceUsd: h.price_usd,
  };
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/**
 * Build the picker option list: SOL first, USDC second (both always
 * present, zero-balance synthetic entries when unheld), then every SPL
 * holding sorted by USD value.
 */
export function buildTokenOptions(
  holdings: ReadonlyArray<SpotHolding>,
  solPriceUsd: number | null,
): TokenOption[] {
  let sol: TokenOption | null = null;
  let usdc: TokenOption | null = null;
  const spl: TokenOption[] = [];
  for (const h of holdings) {
    if (h.bucket === 'sol' || h.mint === SOL_MINT) {
      // Native SOL (spot serves it under the wSOL sentinel mint).
      sol = { ...holdingToOption(h, 'SOL'), mint: SOL_MINT, symbol: 'SOL' };
    } else if (h.mint === USDC_MINT) {
      usdc = { ...holdingToOption(h, 'USDC'), symbol: 'USDC' };
    } else if (h.bucket === 'spl' || h.bucket === 'stable') {
      spl.push(holdingToOption(h, shortMint(h.mint)));
    }
    // `unknown` stays out of the picker ON PURPOSE: the classifier only
    // assigns it to holdings with no price AND no user-owned origin
    // evidence — in practice airdropped spam, often dozens-to-hundreds of
    // mints per active wallet, and the picker has no search/virtualization
    // to absorb them (Portfolio hides the same bucket behind an explicit
    // toggle). A genuinely held coin the user is LOOKING AT is covered
    // regardless: the page-mint option + the live token-balance overlay
    // carry its real balance even while spot has no price for it.
  }
  spl.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const solOption: TokenOption = sol ?? {
    mint: SOL_MINT,
    symbol: 'SOL',
    name: 'Solana',
    logo: null,
    decimals: SOL_DECIMALS,
    balanceBaseUnits: null,
    balanceUi: null,
    valueUsd: null,
    priceUsd: solPriceUsd,
  };
  const usdcOption: TokenOption = usdc ?? {
    mint: USDC_MINT,
    symbol: 'USDC',
    name: 'USD Coin',
    logo: null,
    decimals: USDC_DECIMALS,
    balanceBaseUnits: null,
    balanceUi: null,
    valueUsd: null,
    priceUsd: 1,
  };
  return [solOption, usdcOption, ...spl];
}

export function findOption(
  options: ReadonlyArray<TokenOption>,
  mint: string,
): TokenOption | null {
  return options.find((o) => o.mint === mint) ?? null;
}

/**
 * Ensure the current trade-page mint is pickable even when the wallet
 * doesn't hold it yet: append a synthetic zero-balance option carrying
 * the page token's identity (symbol/logo) and live USD price.
 */
export function withPageMintOption(
  options: ReadonlyArray<TokenOption>,
  page: { mint: string; symbol: string; name: string | null; logo: string | null },
  priceUsd: number | null,
): TokenOption[] {
  const existing = findOption(options, page.mint);
  if (existing) {
    // Holdings row wins for balance; enrich identity blanks from the page.
    const merged: TokenOption = {
      ...existing,
      symbol: existing.symbol.length > 0 ? existing.symbol : page.symbol,
      logo: existing.logo ?? page.logo,
      priceUsd: existing.priceUsd ?? priceUsd,
    };
    return options.map((o) => (o.mint === page.mint ? merged : o));
  }
  return [
    ...options,
    {
      mint: page.mint,
      symbol: page.symbol,
      name: page.name,
      logo: page.logo,
      decimals: PAGE_MINT_DECIMALS,
      balanceBaseUnits: null,
      balanceUi: null,
      valueUsd: null,
      priceUsd,
    },
  ];
}

export function useSpotHoldings(walletAccountId: string | null): SpotHoldingsState {
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const enabled = mirrorSignedIn !== false;
  // Dormancy: a hidden trade pane must not keep the spot poll alive
  // (TradePage stops its other polls on the same signal; default is
  // visible for standalone mounts).
  const paneHidden = useTradePaneHidden();
  const spotQ = useQuery<SpotResult>({
    // Same key shape as SpotTab so the cache entry is shared.
    queryKey: ['api', 'v1', 'portfolio', 'spot', walletAccountId],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(
          await fetchSpot({ walletAccountId }, { signal, authToken: token }),
          token,
        ),
      ),
    enabled,
    refetchInterval: paneHidden ? false : SPOT_REFETCH_MS,
    refetchOnWindowFocus: false,
    staleTime: 8_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
    placeholderData: keepPreviousData,
  });

  const data = spotQ.data;
  const options = useMemo(() => {
    if (data?.kind !== 'ok') return buildTokenOptions([], null);
    return buildTokenOptions(data.holdings, data.solPriceUsd);
  }, [data]);

  return {
    options,
    solPriceUsd: data?.kind === 'ok' ? data.solPriceUsd : null,
    loading: spotQ.isPending,
  };
}
