/**
 * Mint extraction for the agent chat's page context (moved verbatim from
 * `AgentChatDockActive` so the window's context chip and its tests share
 * one parser). Same accept rule as PersistentTradePane's mint parser
 * (base58, 32-64 chars).
 */
export function mintFromPathname(pathname: string | null): string | null {
  const match = /^\/trade\/([^/]+)$/.exec(pathname ?? '');
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  if (raw.length < 32 || raw.length > 64) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) return null;
  return raw;
}
