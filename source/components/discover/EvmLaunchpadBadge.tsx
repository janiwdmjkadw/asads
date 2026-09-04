import {
  evmLaunchOption,
  type EvmLaunchpad,
  type EvmLaunchProfile,
  type EvmLaunchVariant,
} from '@/lib/evm/discoverAdapter';

const BRAND = {
  four_meme: { logo: 'https://four.meme/apple-touch-icon.png', color: '#facc15' },
  flap: { logo: 'https://flap.sh/icon.svg', color: '#d0ff00' },
  pons: { logo: 'https://robinhood.ponslaunchpad.com/favicon.png', color: '#cbd5e1' },
  pools_trade: { logo: 'https://app.uniswap.org/favicon.ico', color: '#ff4dba' },
} as const;

function profileMode(profile: EvmLaunchProfile | null): string | null {
  if (profile === null) return null;
  if (profile.generation === 'portal') {
    const tax = profile.taxMode === 'none'
      ? 'no tax'
      : profile.taxMode === undefined
        ? null
        : `${profile.taxMode} tax`;
    return [
      profile.tokenVersion === undefined ? null : `v${profile.tokenVersion}`,
      profile.migratorType === undefined ? null : `M${profile.migratorType}`,
      tax,
    ].filter((part): part is string => part !== null).join(' · ');
  }
  if (profile.generation === 'tm2' && profile.mode !== undefined) {
    return profile.mode === 'x' ? 'X mode' : 'classic';
  }
  if (profile.generation === 'open_four_v12' && profile.phase !== undefined) {
    return profile.phase.replaceAll('_', ' ');
  }
  return null;
}

export function EvmLaunchpadBadge({
  chain,
  launchpad,
  launchVariant,
  profile = null,
  selected,
}: {
  chain: string;
  launchpad: EvmLaunchpad;
  launchVariant: EvmLaunchVariant;
  profile?: EvmLaunchProfile | null;
  selected?: boolean;
}) {
  const option = evmLaunchOption(chain, launchpad, launchVariant);
  if (option === null) return null;
  const brand = BRAND[launchpad];
  const detail = profileMode(profile);
  const text = `${option.label} · ${option.modeLabel}${detail === null ? '' : ` · ${detail}`}`;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5"
      data-launchpad={launchpad}
      data-launch-variant={launchVariant}
      data-selected={selected === undefined ? undefined : selected ? 'true' : 'false'}
      title={text}
      aria-label={text}
      style={{
        borderColor: selected === false ? 'var(--hairline)' : brand.color,
        color: selected === false ? 'var(--ink-3)' : 'var(--ink-1)',
        background: selected === false
          ? 'transparent'
          : 'color-mix(in srgb, var(--panel) 82%, transparent)',
        fontFamily: 'var(--mono)',
        fontSize: 9,
        lineHeight: 1,
        opacity: selected === false ? 0.62 : 1,
      }}
    >
      <span
        className="inline-flex size-3 shrink-0 rounded-full"
        aria-hidden="true"
        style={{
          backgroundColor: brand.color,
          backgroundImage: `url(${brand.logo})`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
        }}
      />
      <span className="truncate">{text}</span>
    </span>
  );
}
