/**
 * Runtime configuration (deploy overhaul): the values that used to be
 * baked into the bundle as NEXT_PUBLIC_* inlines but must be settable per
 * ENVIRONMENT without a rebuild — the Clerk publishable key (which also
 * derives the CSP allowlist) and the operational feature flags. Moving
 * them to runtime is what makes one terminal artifact promotable across
 * environments (staging bundle == prod bundle) and lets a flag flip be a
 * process restart instead of a 4-minute rebuild.
 *
 * How the value reaches the browser: the root layout renders
 * `runtimeConfigHtml()` into an inline <head> script BEFORE the bundle
 * hydrates, setting `window.__RUNTIME_CONFIG__`. Client code (React or
 * not) calls `getRuntimeConfig()`, which prefers that object; on the
 * server it reads the process env per call.
 *
 * Precedence per field: TERMINAL_* (real runtime env, never inlined by
 * Next) → NEXT_PUBLIC_* (inlined at build — keeps every existing
 * .env.local and the legacy build-on-host deploy working unchanged) →
 * default. A CI-built artifact simply ships with the NEXT_PUBLIC
 * fallbacks unset and the deployer provides TERMINAL_* to the process.
 *
 * NOT here, deliberately:
 * - NEXT_PUBLIC_BUILD_SHA — per-build by definition; stays inlined.
 * - Clerk sign-in/up URLs and redirect paths — same on every env.
 * - API bases — the terminal is served behind the SAME origin as the
 *   trading/ingestion edge routes, so lib/api/{trading,ingestion}.ts
 *   already fall back to same-origin relative paths when the
 *   NEXT_PUBLIC_*_API_BASE inlines are unset. Environment-neutral beats
 *   environment-injected.
 */

export interface RuntimeConfig {
  /** Browser-safe by design (domain-bound JWTs, not bearer auth). */
  clerkPublishableKey: string;
  /** LaunchDarkly client-side ID. Empty = no LD client, every flag off. */
  ldClientId: string;
  /** Agent chat surface (dock + /agent route). */
  agentChat: boolean;
  /** Scripted mock agent backend (dev/test only). */
  agentChatMock: boolean;
  /** Invite-code access gate bypass (dev only). */
  accessGateDisabled: boolean;
  /** Fake-ready wallet state for UI work (dev only). */
  forceWalletReady: boolean;
  /**
   * Fake agent-wallet setup state for UI work (dev only). One of
   * `unfunded` | `final` | `ready`; anything else means off.
   */
  forceAgentWalletSetup: string;
  /** Multi-wallet batch order cap (mirrors the api-side clamp). */
  batchOrdersMaxWallets: number;
  /** In-terminal wallet creation affordances. */
  walletCreateEnabled: boolean;
  /** In-terminal SOL transfer affordances. */
  walletTransferEnabled: boolean;
  /**
   * Which invite-code modal the homepage gate mounts:
   * `certificate` (default) or `classic` for the original creator pass.
   * Runtime so the two can be swapped per environment without a rebuild.
   */
  inviteModalVariant: string;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

function str(runtime: string | undefined, inlined: string | undefined, dflt: string): string {
  const r = runtime?.trim();
  if (r !== undefined && r !== '') return r;
  const i = inlined?.trim();
  if (i !== undefined && i !== '') return i;
  return dflt;
}

function bool(runtime: string | undefined, inlined: string | undefined, dflt = false): boolean {
  const v = str(runtime, inlined, dflt ? 'true' : 'false');
  return v === 'true' || v === '1';
}

function num(runtime: string | undefined, inlined: string | undefined, dflt: number): number {
  const v = Number(str(runtime, inlined, String(dflt)));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/**
 * Server-side read, evaluated per call. The NEXT_PUBLIC_* member accesses
 * are written literally so Next statically inlines them in the CLIENT
 * bundle (where this function is the no-window fallback for tests) while
 * the TERMINAL_* reads stay dynamic on the server.
 */
export function serverRuntimeConfig(): RuntimeConfig {
  return {
    clerkPublishableKey: str(
      process.env.TERMINAL_CLERK_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      '',
    ),
    ldClientId: str(process.env.TERMINAL_LD_CLIENT_ID, process.env.NEXT_PUBLIC_LD_CLIENT_ID, ''),
    agentChat: bool(process.env.TERMINAL_AGENT_CHAT, process.env.NEXT_PUBLIC_AGENT_CHAT),
    agentChatMock: bool(process.env.TERMINAL_AGENT_CHAT_MOCK, process.env.NEXT_PUBLIC_AGENT_CHAT_MOCK),
    accessGateDisabled: bool(
      process.env.TERMINAL_ACCESS_GATE_DISABLED,
      process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED,
    ),
    forceWalletReady: bool(
      process.env.TERMINAL_FORCE_WALLET_READY,
      process.env.NEXT_PUBLIC_FORCE_WALLET_READY,
    ),
    forceAgentWalletSetup: str(
      process.env.TERMINAL_FORCE_AGENT_WALLET_SETUP,
      process.env.NEXT_PUBLIC_FORCE_AGENT_WALLET_SETUP,
      '',
    ),
    batchOrdersMaxWallets: num(
      process.env.TERMINAL_BATCH_ORDERS_MAX_WALLETS,
      process.env.NEXT_PUBLIC_BATCH_ORDERS_MAX_WALLETS,
      20,
    ),
    walletCreateEnabled: bool(
      process.env.TERMINAL_WALLET_CREATE_ENABLED,
      process.env.NEXT_PUBLIC_TERMINAL_WALLET_CREATE_ENABLED,
    ),
    walletTransferEnabled: bool(
      process.env.TERMINAL_WALLET_TRANSFER_ENABLED,
      process.env.NEXT_PUBLIC_TERMINAL_WALLET_TRANSFER_ENABLED,
    ),
    inviteModalVariant: str(
      process.env.TERMINAL_INVITE_MODAL_VARIANT,
      process.env.NEXT_PUBLIC_INVITE_MODAL_VARIANT,
      'certificate',
    ),
  };
}

/** Isomorphic accessor — THE way to read environment-varying config. */
export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__ !== undefined) {
    return window.__RUNTIME_CONFIG__;
  }
  return serverRuntimeConfig();
}

/**
 * Inline-script body for the root layout's <head>, rendered BEFORE the
 * bundle so window.__RUNTIME_CONFIG__ exists prior to hydration and
 * clerk-js boot. `<` is escaped so config values can never close the
 * script tag (XSS hygiene for a JSON payload in HTML).
 */
export function runtimeConfigHtml(config: RuntimeConfig = serverRuntimeConfig()): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__RUNTIME_CONFIG__=${json};`;
}

/**
 * The Clerk Frontend API origin, decoded from the publishable key
 * (base64 of "<host>$" after the pk_test_/pk_live_ prefix). Shared by
 * the layout's preconnect/preload hints and the middleware CSP — a wrong
 * origin here blocks Clerk entirely (`failed_to_load_clerk_js`).
 * atob-based so it runs in the edge runtime, node, and the browser.
 */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  const encoded = /^pk_(?:test|live)_(.+)$/.exec(publishableKey?.trim() ?? '')?.[1];
  if (encoded === undefined) return null;
  try {
    const host = atob(encoded).replace(/\$+$/, '').trim();
    if (host === '' || /[^a-zA-Z0-9.-]/.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}
