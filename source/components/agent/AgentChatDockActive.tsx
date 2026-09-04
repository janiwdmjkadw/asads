'use client';

/**
 * Flag-on body of the agent chat dock: mounts the floating agent window
 * on EVERY route (the window is global; the mint only drives its context
 * chip) and owns the global ⌘K / Ctrl+K toggle. The old floating "agent"
 * pill is retired — the window opens from the topnav "Ask the agent…"
 * button, the shortcut, or restored open state. Lives in its own async
 * chunk behind `AgentChatDock`'s flag gate; the heavier window is a
 * second dynamic chunk so the dock itself stays feather-weight.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { mintFromPathname } from '@/lib/agent/mint-context';

const AgentWindow = dynamic(() => import('./AgentWindow').then((m) => m.AgentWindow), {
  ssr: false,
});

export function AgentChatDockActive() {
  const pathname = usePathname();
  const mint = mintFromPathname(pathname);
  const { userId } = useAuth();
  const setIdentity = useAgentChatStore((s) => s.setIdentity);
  const windowOpen = useAgentChatStore((s) => s.windowOpen);
  const closeWindow = useAgentChatStore((s) => s.closeWindow);
  const toggleWindow = useAgentChatStore((s) => s.toggleWindow);

  // Identity feed for the store. The dock stays mounted on every route
  // whether or not the window is open, so this catches an active-session
  // switch (signing in with a wallet is a SEPARATE Clerk user) even while
  // the chat is closed — the store wipes user A's state before user B can
  // see it, and namespaces the panel-restore key per user.
  useEffect(() => {
    setIdentity(userId ?? null);
  }, [userId, setIdentity]);

  // windowOpen seeds from localStorage in the store initializer; gate the
  // first paint behind mount so a server-rendered shell can't mismatch.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Global palette-style shortcut: ⌘K / Ctrl+K toggles the window. It
  // must fire even when focus sits in an input (standard palette
  // behavior), so there is deliberately no target filtering.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      if (e.repeat) return;
      e.preventDefault();
      toggleWindow();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleWindow]);

  if (!hydrated || !windowOpen) return null;
  return <AgentWindow mint={mint} onClose={closeWindow} />;
}
