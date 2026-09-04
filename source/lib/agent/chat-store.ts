'use client';

/**
 * Agent chat store — the chat surface's OWN zustand store (F§ inv. 4:
 * chat state is isolated; streaming ticks update THIS store only, so
 * chart/feed/trading components — which never subscribe to it — cannot
 * re-render from them). Follows the repo store pattern (zustand `create`,
 * module singleton, plain-data state + action methods).
 *
 * Refresh-mid-turn reattach (F§ inv. 2): the active run id is persisted
 * per conversation in sessionStorage (cleared on terminal status);
 * `attachIfActive()` re-opens the stream on mount. The refresh reattach
 * resumes from seq 0 — the reload dropped all in-memory part state, so a
 * full catch-up replay (or server snapshot when the gap is large) is the
 * correct rebuild; resuming from the last SEEN seq is only valid for
 * live-connection drops, which the stream reader handles internally with
 * its own cursor.
 */

import { create } from 'zustand';
import {
  applyRunEvent,
  degradedBannerFor,
  emptyStreamState,
  streamParts,
  type DegradedBanner,
  type StreamState,
} from './chat-core';
import { parseParts, type ParsedPart } from './contracts';
import {
  AgentTransportError,
  cancelRun,
  createConversation,
  listConversations,
  listMessages,
  mintIdempotencyKey,
  openRunStream,
  postMessage,
  type ConversationSummary,
  type RunStreamHandle,
} from './transport';
import {
  parseStoredWindowState,
  serializeWindowState,
  WINDOW_STORAGE_KEY,
  type WindowGeometry,
} from './window-geometry';

const ACTIVE_RUN_PREFIX = 'agent-chat:active-run:';
/**
 * Namespaced PER CLERK USER. A wallet sign-in is a SEPARATE Clerk user, so
 * an active-session switch used to leave this tab restoring the previous
 * identity's conversation id — which the API then 404s under RLS forever.
 * Null until the component layer reports an identity (`setIdentity`).
 */
const PANEL_CONVERSATION_PREFIX = 'agent-chat:panel-conversation:';

function panelKey(userId: string | null): string | null {
  return userId === null ? null : PANEL_CONVERSATION_PREFIX + userId;
}

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode quotas): reattach degrades to a fresh view
  }
}

function readActiveRun(conversationId: string): string | null {
  return sessionGet(ACTIVE_RUN_PREFIX + conversationId);
}

function writeActiveRun(conversationId: string, runId: string | null): void {
  sessionSet(ACTIVE_RUN_PREFIX + conversationId, runId);
}

/**
 * Window open-state + geometry persist in ONE localStorage blob
 * (`agent-chat:window:v1`): a single global position across routes for
 * spatial muscle memory, surviving reloads (unlike the old per-session
 * panel flag, whose `agent-chat:panel-open` key is intentionally never
 * read again).
 */
function readWindowState(): { open: boolean; geometry: WindowGeometry | null } {
  try {
    const parsed = parseStoredWindowState(window.localStorage.getItem(WINDOW_STORAGE_KEY));
    if (parsed !== null) return parsed;
  } catch {
    // storage unavailable (private mode quotas): defaults below
  }
  return { open: false, geometry: null };
}

function writeWindowState(open: boolean, geometry: WindowGeometry | null): void {
  try {
    window.localStorage.setItem(WINDOW_STORAGE_KEY, serializeWindowState({ open, geometry }));
  } catch {
    // storage unavailable: the window still works, placement just won't stick
  }
}

export interface ChatTurnView {
  key: string;
  role: 'user' | 'assistant';
  parts: ParsedPart[];
}

export type ChatConnection = 'idle' | 'posting' | 'connecting' | 'streaming' | 'reconnecting';

interface SendFailure {
  text: string;
  idempotencyKey: string;
  clientContext?: unknown;
  code: string;
}

/** Typed history-load failure, so the leaf can name WHICH failure it is. */
export interface HistoryFailure {
  /** HTTP status, or null when the request never got a response. */
  status: number | null;
  code: string;
}

export interface AgentChatState {
  /** Active Clerk user id, reported by the component layer; null until known. */
  userId: string | null;
  windowOpen: boolean;
  /** Floating-window rect; null until the user first drags/resizes. */
  geometry: WindowGeometry | null;
  /** Bumped by every openWindow() so an already-open window re-focuses its input. */
  focusNonce: number;
  conversationId: string | null;
  conversations: ConversationSummary[];
  conversationsStatus: 'idle' | 'loading' | 'ready' | 'error';
  history: ChatTurnView[];
  historyStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Set alongside `historyStatus: 'error'`; null in every other status. */
  historyError: HistoryFailure | null;
  stream: StreamState | null;
  runId: string | null;
  connection: ChatConnection;
  banner: DegradedBanner | null;
  sendFailure: SendFailure | null;

  /**
   * Report the active Clerk user. A CHANGE of identity wipes the chat state
   * so nothing from user A survives under user B; the first report (null →
   * id) is not a change and keeps whatever is already on screen.
   */
  setIdentity: (userId: string | null) => void;
  openWindow: () => void;
  closeWindow: () => void;
  toggleWindow: () => void;
  setGeometry: (geometry: WindowGeometry) => void;
  loadConversations: () => Promise<void>;
  /** Select (or clear) the active conversation and load its history. */
  selectConversation: (id: string | null) => Promise<void>;
  /** Panel entry point: restore the session's panel conversation, if any. */
  initPanelConversation: () => Promise<void>;
  newConversation: () => Promise<void>;
  send: (text: string, clientContext?: unknown) => Promise<void>;
  /** Retry a POST-level failure with the SAME idempotency key. */
  retrySend: () => Promise<void>;
  /**
   * Retry after a FAILED run (retryable error part / banner): re-sends the
   * last user turn as a NEW turn (fresh key — the failed turn's slot was
   * consumed and filled with the error part server-side).
   */
  retryLastTurn: () => Promise<void>;
  cancelActiveRun: () => Promise<void>;
  dismissBanner: () => void;
}

/** Module-held reader handle (non-serializable; the store is a singleton). */
let reader: RunStreamHandle | null = null;

function stopReader(): void {
  reader?.stop();
  reader = null;
}

function turnsFromMessages(messages: { id: string; turn_role: 'user' | 'assistant'; parts: unknown }[]): ChatTurnView[] {
  const turns: ChatTurnView[] = [];
  for (const m of messages) {
    const parts = parseParts(m.parts);
    // Reserved assistant slots stream live (or get filled by sweeps);
    // an empty slot renders nothing meaningful — skip it.
    if (m.turn_role === 'assistant' && parts.length === 0) continue;
    turns.push({ key: m.id, role: m.turn_role, parts });
  }
  return turns;
}

/**
 * Everything in the store that belongs to ONE identity. Window open-state
 * and geometry are deliberately absent: placement is a device preference
 * (localStorage, global across routes), not this user's chat state, so an
 * identity switch must not yank the window out from under the viewer.
 */
type ChatIdentityState = Pick<
  AgentChatState,
  | 'conversationId'
  | 'conversations'
  | 'conversationsStatus'
  | 'history'
  | 'historyStatus'
  | 'historyError'
  | 'stream'
  | 'runId'
  | 'connection'
  | 'banner'
  | 'sendFailure'
>;

const INITIAL_CHAT_STATE: ChatIdentityState = {
  conversationId: null,
  conversations: [],
  conversationsStatus: 'idle',
  history: [],
  historyStatus: 'idle',
  historyError: null,
  stream: null,
  runId: null,
  connection: 'idle',
  banner: null,
  sendFailure: null,
};

export const useAgentChatStore = create<AgentChatState>((set, get) => {
  const attach = (conversationId: string, runId: string, lastSeq: number): void => {
    stopReader();
    set({
      runId,
      stream: emptyStreamState(lastSeq),
      connection: 'connecting',
    });
    reader = openRunStream({
      runId,
      lastEventId: lastSeq,
      onPhase: (phase) => {
        if (get().runId !== runId) return;
        if (phase === 'open') set({ connection: 'streaming' });
        else if (phase === 'reconnecting') set({ connection: 'reconnecting' });
      },
      onFatal: () => {
        // Run vanished (404 after retention, wrong session): stop cleanly
        // and clear the persisted cursor — never a silent hang (F§ inv. 5).
        if (get().runId !== runId) return;
        writeActiveRun(conversationId, null);
        stopReader();
        set({ runId: null, stream: null, connection: 'idle' });
      },
      onEvent: ({ seq, kind, payload }) => {
        const state = get();
        if (state.runId !== runId || state.stream === null) return;
        const next = applyRunEvent(state.stream, seq, kind, payload);
        if (kind === 'error') {
          const rec =
            typeof payload === 'object' && payload !== null
              ? (payload as { code?: unknown; retryable?: unknown })
              : {};
          const banner = degradedBannerFor(
            typeof rec.code === 'string' ? rec.code : 'unknown',
            rec.retryable === true,
          );
          if (banner !== null) set({ banner });
        }
        if (next.terminal) {
          // Finalize: fold the streamed turn into history keyed by run id
          // (idempotent against a later history reload), clear the cursor.
          writeActiveRun(conversationId, null);
          stopReader();
          const parts = streamParts(next);
          set((s) => ({
            stream: null,
            runId: null,
            connection: 'idle',
            history:
              parts.length > 0
                ? [...s.history.filter((t) => t.key !== `run-${runId}`), { key: `run-${runId}`, role: 'assistant' as const, parts }]
                : s.history,
          }));
          return;
        }
        if (next !== state.stream) set({ stream: next });
      },
    });
  };

  const loadHistory = async (conversationId: string): Promise<void> => {
    set({ historyStatus: 'loading', historyError: null });
    try {
      const { messages } = await listMessages(conversationId);
      if (get().conversationId !== conversationId) return;
      set({ history: turnsFromMessages(messages), historyStatus: 'ready' });
    } catch (err) {
      if (get().conversationId !== conversationId) return;
      // A 404 means this conversation is not the current user's (RLS after
      // an identity switch) or no longer exists. Self-heal: drop the stored
      // panel id and fall back to the empty state, rather than pinning the
      // surface to an error the viewer can never clear.
      if (err instanceof AgentTransportError && err.status === 404) {
        const key = panelKey(get().userId);
        if (key !== null) sessionSet(key, null);
        writeActiveRun(conversationId, null);
        stopReader();
        set({
          conversationId: null,
          history: [],
          historyStatus: 'idle',
          historyError: null,
          stream: null,
          runId: null,
          connection: 'idle',
          banner: null,
          sendFailure: null,
        });
        return;
      }
      // Every other failure keeps the error leaf, but now carries WHICH
      // failure it was — the send path's idiom (typed code, 'network' when
      // the request never reached the server).
      set({
        historyStatus: 'error',
        historyError: {
          status: err instanceof AgentTransportError ? err.status : null,
          code: err instanceof AgentTransportError ? err.code : 'network',
        },
      });
    }
  };

  const attachIfActive = (conversationId: string): void => {
    const activeRunId = readActiveRun(conversationId);
    if (activeRunId === null) return;
    // Resume from 0: in-memory part state died with the previous page, so
    // replay (or a server snapshot for large gaps) rebuilds the turn.
    attach(conversationId, activeRunId, 0);
  };

  const initialWindow =
    typeof window !== 'undefined' ? readWindowState() : { open: false, geometry: null };

  return {
    userId: null,
    windowOpen: initialWindow.open,
    geometry: initialWindow.geometry,
    focusNonce: 0,
    ...INITIAL_CHAT_STATE,

    setIdentity: (userId) => {
      const current = get().userId;
      if (current === userId) return;
      // First report of an identity: nothing here belongs to anyone else
      // yet, so keep the state (a restore may already be in flight).
      if (current === null) {
        set({ userId });
        return;
      }
      stopReader();
      set({ ...INITIAL_CHAT_STATE, userId });
    },

    openWindow: () => {
      writeWindowState(true, get().geometry);
      set((s) => ({ windowOpen: true, focusNonce: s.focusNonce + 1 }));
    },
    closeWindow: () => {
      writeWindowState(false, get().geometry);
      set({ windowOpen: false });
    },
    toggleWindow: () => {
      if (get().windowOpen) get().closeWindow();
      else get().openWindow();
    },
    setGeometry: (geometry) => {
      writeWindowState(get().windowOpen, geometry);
      set({ geometry });
    },

    loadConversations: async () => {
      set({ conversationsStatus: 'loading' });
      try {
        const { conversations } = await listConversations();
        set({ conversations, conversationsStatus: 'ready' });
      } catch {
        set({ conversationsStatus: 'error' });
      }
    },

    selectConversation: async (id) => {
      if (get().conversationId === id) return;
      stopReader();
      set({
        conversationId: id,
        history: [],
        historyStatus: id === null ? 'idle' : 'loading',
        historyError: null,
        stream: null,
        runId: null,
        connection: 'idle',
        banner: null,
        sendFailure: null,
      });
      if (id === null) return;
      await loadHistory(id);
      // loadHistory deselects on a 404 (and an identity switch can land
      // mid-load): never attach a run to a conversation we just dropped.
      if (get().conversationId !== id) return;
      attachIfActive(id);
    },

    initPanelConversation: async () => {
      const key = panelKey(get().userId);
      // Identity not known yet — the caller re-runs once it arrives.
      if (key === null) return;
      const saved = sessionGet(key);
      if (saved !== null && get().conversationId === null) {
        await get().selectConversation(saved);
      }
    },

    newConversation: async () => {
      await get().selectConversation(null);
    },

    send: async (text, clientContext) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const state = get();
      if (state.connection !== 'idle') return; // one queued run per conversation (§16 cap)

      set({ connection: 'posting', banner: null, sendFailure: null });

      let conversationId = state.conversationId;
      try {
        if (conversationId === null) {
          const conversation = await createConversation(trimmed.slice(0, 80));
          conversationId = conversation.id;
          const key = panelKey(get().userId);
          if (key !== null) sessionSet(key, conversationId);
          set({
            conversationId,
            history: [],
            historyStatus: 'ready',
            conversations: [conversation, ...get().conversations],
          });
        }
      } catch (err) {
        const code = err instanceof AgentTransportError ? err.code : 'network';
        const retryable = err instanceof AgentTransportError ? err.retryable : true;
        set({
          connection: 'idle',
          banner: degradedBannerFor(code, retryable) ?? {
            code,
            message: 'Could not start a conversation.',
            retryable: true,
          },
        });
        return;
      }

      const idempotencyKey = mintIdempotencyKey();
      // Optimistic user-turn render (04 "Smoothness").
      set((s) => ({
        history: [...s.history, { key: `local-${idempotencyKey}`, role: 'user' as const, parts: parseParts([{ v: 1, type: 'text', text: trimmed }]) }],
      }));

      try {
        const accepted = await postMessage({
          conversationId,
          text: trimmed,
          clientContext,
          idempotencyKey,
        });
        writeActiveRun(conversationId, accepted.run_id);
        attach(conversationId, accepted.run_id, 0);
      } catch (err) {
        const code = err instanceof AgentTransportError ? err.code : 'network';
        const retryable = err instanceof AgentTransportError ? err.retryable : true;
        set({
          connection: 'idle',
          sendFailure: { text: trimmed, idempotencyKey, clientContext, code },
          banner:
            degradedBannerFor(code, retryable) ??
            (code === 'network'
              ? null // inline retry row covers plain network failures
              : { code, message: 'The message was not accepted.', retryable }),
        });
      }
    },

    retrySend: async () => {
      const failure = get().sendFailure;
      const conversationId = get().conversationId;
      if (failure === null || conversationId === null || get().connection !== 'idle') return;
      set({ connection: 'posting', sendFailure: null, banner: null });
      try {
        // SAME idempotency key: the admission saga resumes, never duplicates.
        const accepted = await postMessage({
          conversationId,
          text: failure.text,
          clientContext: failure.clientContext,
          idempotencyKey: failure.idempotencyKey,
        });
        writeActiveRun(conversationId, accepted.run_id);
        attach(conversationId, accepted.run_id, 0);
      } catch (err) {
        const code = err instanceof AgentTransportError ? err.code : 'network';
        const retryable = err instanceof AgentTransportError ? err.retryable : true;
        set({
          connection: 'idle',
          sendFailure: { ...failure, code },
          banner: degradedBannerFor(code, retryable),
        });
      }
    },

    retryLastTurn: async () => {
      const state = get();
      if (state.connection !== 'idle') return;
      const lastUser = [...state.history].reverse().find((t) => t.role === 'user');
      const firstText = lastUser?.parts.find((p) => p.known && p.part.type === 'text');
      if (firstText === undefined || !firstText.known || firstText.part.type !== 'text') return;
      await get().send(firstText.part.text);
    },

    cancelActiveRun: async () => {
      const runId = get().runId;
      if (runId === null) return;
      try {
        await cancelRun(runId);
        // Terminal run_status arrives on the stream and finalizes state.
      } catch {
        // Cancel is best-effort (202 when owned); the stream stays live.
      }
    },

    dismissBanner: () => set({ banner: null }),
  };
});

/** Test hook: reset the singleton between cases. */
export function _resetAgentChatStoreForTests(): void {
  stopReader();
  useAgentChatStore.setState({
    userId: null,
    windowOpen: false,
    geometry: null,
    focusNonce: 0,
    ...INITIAL_CHAT_STATE,
  });
}

