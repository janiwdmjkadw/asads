import { useEffect, useState } from 'react';
import { Caption, HairlineDivider, Numeral, Stat } from '@/components/listen/primitives';
import { compactNumber } from '@/lib/format';
import { Dolphin } from '@/components/listen/icons/Icons';
import { TokenImagePreview } from '@/components/discover/TokenImagePreview';
import { CallCoinButton } from './CallCoinButton';
import { TokenMetaRow } from './TokenMetaRow';
import { useColorCycle, type ColorStop } from './useColorCycle';
import type { MockToken, VolSnapshot } from './mockTrade';

interface Props {
  token: MockToken;
  vol: VolSnapshot;
  /** Trade page still on a stub snapshot — disables "Call this coin". */
  callDisabled?: boolean;
}

/* Three-stop rotation for the MC value. Hues stay roughly equiluminant so
   the rotation reads as motion, not a status change. */
const MC_CYCLE: readonly ColorStop[] = [
  { color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.35)' },
  { color: '#fb923c', glow: 'rgba(251, 146, 60, 0.35)' },
  { color: '#22c77e', glow: 'rgba(52, 211, 153, 0.35)' },
];

export function TokenHeaderBar({ token, vol, callDisabled = false }: Props) {
  return (
    <div className="panel flex w-full shrink-0 flex-nowrap items-center gap-x-3 px-5 py-4 xl:gap-x-6">
      <LeftCluster token={token} />

      {/* Flexible gaps keep the three clusters in ONE row at every width: they
          grow to justify on wide screens and collapse to 0 as space tightens,
          so the row compresses (the identity truncates) instead of wrapping. */}
      <div className="min-w-0 flex-1" />
      <CenterCluster token={token} />
      <div className="min-w-0 flex-1" />
      <VolStats vol={vol} />
      <CallCoinButton token={token} vol={vol} disabled={callDisabled} />
    </div>
  );
}

function LeftCluster({ token }: { token: MockToken }) {
  return (
    <div className="flex min-w-0 items-center gap-3 xl:gap-5">
      <Avatar token={token} />

      <div className="flex min-w-0 items-center gap-2.5">
        {/* Ticker is the priority identity — keep it fully readable (shrink-0)
            so it never gets crushed; only a pathologically long symbol caps +
            truncates. The (supplementary) name yields first when space tightens. */}
        <span className="t-display max-w-[16ch] shrink-0 truncate">{token.symbol}</span>
        {/* Long form name is supplementary — capped + truncates, and hidden on
            narrow widths to give the symbol + meta row room. */}
        <span
          className="hidden min-w-0 max-w-[22ch] truncate text-[17px] md:inline"
          style={{ color: 'var(--ink-2)', fontWeight: 400, lineHeight: '26px' }}
        >
          {token.name}
        </span>
      </div>

      <span className="hidden sm:inline-flex">
        <HairlineDivider orientation="v" length={28} />
      </span>

      <TokenMetaRow token={token} />
    </div>
  );
}

function Avatar({ token }: { token: MockToken }) {
  const [imageSrc, setImageSrc] = useState(token.imageUrl);
  const [failed, setFailed] = useState(false);
  const showImage = imageSrc && !failed;

  useEffect(() => {
    setImageSrc(token.imageUrl);
    setFailed(false);
  }, [token.imageFallbackUrl, token.imageUrl]);

  return (
    <div className="relative shrink-0">
      <TokenImagePreview src={imageSrc} alt={`${token.name} token image`} disabled={!showImage}>
        <div
          className="token-avatar overflow-hidden rounded-[var(--r-md)]"
          style={{ width: 52, height: 52 }}
        >
          {showImage ? (
            <img
              src={imageSrc}
              alt={`${token.name} token image`}
              className="block h-full w-full object-cover"
              draggable={false}
              onError={() => {
                if (token.imageFallbackUrl && imageSrc !== token.imageFallbackUrl) {
                  setImageSrc(token.imageFallbackUrl);
                  return;
                }
                setFailed(true);
              }}
            />
          ) : (
            <Dolphin style={{ width: '100%', height: '100%' }} />
          )}
        </div>
      </TokenImagePreview>
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-full"
        style={{
          width: 12,
          height: 12,
          background: 'var(--up)',
          boxShadow: '0 0 10px var(--up)',
          border: '2px solid var(--surface)',
        }}
        aria-hidden
      />
    </div>
  );
}

function CenterCluster({ token }: { token: MockToken }) {
  /* MC value cycles through cyan/orange/green every 4s — gentle live cue. */
  const mc = useColorCycle(MC_CYCLE, 4000);

  return (
    <div
      className="grid shrink-0 gap-x-4 xl:gap-x-8 xl:border-x xl:border-[var(--hairline)] xl:px-5"
      style={{
        gridTemplateColumns: 'repeat(4, auto)',
        rowGap: '0.375rem',
        alignItems: 'center',
        justifyItems: 'center',
      }}
    >
      <Caption size="lg">MC</Caption>
      <Caption size="lg">Price</Caption>
      <Caption size="lg">Liquidity</Caption>
      <Caption size="lg">ATH</Caption>

      <Numeral
        size="hero"
        style={{
          color: mc.color,
          textShadow: `0 0 10px ${mc.glow}`,
          transition: 'color 1200ms ease, text-shadow 1200ms ease',
        }}
      >
        {token.marketCap}
      </Numeral>
      <Numeral size="display" tone="ink-1">
        {token.price}
      </Numeral>
      <Numeral size="display" tone="primary">
        {token.liquidity}
      </Numeral>
      <Numeral size="display" tone="up">
        {token.ath}
      </Numeral>
    </div>
  );
}

function VolStats({ vol }: { vol: VolSnapshot }) {
  const buys = vol.buys.count;
  const sells = vol.sells.count;
  const total = buys + sells;
  /* No activity yet → render the bar 50/50 so it reads as neutral flow,
     not a one-sided collapse. */
  const buyPct = total === 0 ? 50 : (buys / total) * 100;

  const trimmed = vol.netVol.trim();
  const netTone = trimmed.startsWith('-') ? 'down' : trimmed.startsWith('+') ? 'up' : 'ink-1';

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-end gap-4 xl:gap-7">
        <Stat label={`${vol.window} Vol`} value={vol.vol} valueTone="ink-1" />
        <Stat
          label="Buys"
          value={`${compactNumber(vol.buys.count)}/${vol.buys.amount}`}
          valueTone="up"
        />
        <Stat
          label="Sells"
          value={`${compactNumber(vol.sells.count)}/${vol.sells.amount}`}
          valueTone="down"
        />
        <Stat label="Net Vol." value={vol.netVol} valueTone={netTone} />
      </div>
      <div className="flex h-[2px] overflow-hidden rounded-full" aria-hidden>
        <div
          style={{
            width: `${buyPct}%`,
            background: 'var(--up)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--up) 70%, transparent)',
            transition: 'width 200ms var(--ease-out)',
          }}
        />
        <div
          style={{
            flex: 1,
            background: 'var(--down)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--down) 70%, transparent)',
          }}
        />
      </div>
    </div>
  );
}
