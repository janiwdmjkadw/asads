import { useEffect, useRef, useState } from 'react';
import { ingestionApiUrl, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { useConnectionStore } from '@/lib/state/connection-store';

/**
 * Phase 7D-2: small unobtrusive ingestion-readiness pill.
 *
 * Polls `/api/readyz` every `intervalMs` (5 s default) and derives
 * one of three states:
 *
 *  - `'ready'`   : `200` + `ready: true` (the chain stream supervisor has
 *                  connected at least once). Renders a tiny green dot.
 *  - `'warming'` : `200` + `ready: false` OR `503` + `ready: false`.
 *                  The daemon is up but hasn't established its first
 *                  upstream connection yet. Amber dot + tooltip.
 *  - `'offline'` : network failure, non-200/503, or an unexpected
 *                  response shape. Red dot + tooltip with the
 *                  a hint to start the local data service.
 *
 * The pill itself is non-interactive (just a colored dot and a
 * `title` tooltip) so it doesn't compete with the surrounding nav
 * controls. Layout footprint is fixed (16×16 dot + tooltip on hover);
 * no shifts when the state changes.
 *
 */
export type IngestionState = 'ready' | 'warming' | 'offline';

interface Props {
  /** Polling cadence, ms. Default 5_000. Tests override this. */
  intervalMs?: number;
  /** Optional className passthrough so the host nav can position it. */
  className?: string;
  /** Optional inline-style passthrough. */
  style?: React.CSSProperties;
}

interface ReadyzPayload {
  ready?: boolean;
  status?: string;
  supervisor_connect_successes?: number;
}

const TOOLTIPS: Record<IngestionState, string> = {
  ready: 'ingestion ready',
  warming: 'ingestion warming up — awaiting first LaserStream connect',
  offline:
    'ingestion offline — the data service is not reachable',
};

const COLORS: Record<IngestionState, string> = {
  ready: 'var(--up, #34d399)',
  warming: '#f5a524',
  offline: 'var(--down, #fb5374)',
};

export function IngestionStatus({ intervalMs = 5_000, className, style }: Props) {
  const status = useIngestionStatus(intervalMs);
  const setIngestion = useConnectionStore((state) => state.setIngestion);

  useEffect(() => {
    setIngestion(status);
  }, [setIngestion, status]);

  return (
    <span
      className={className}
      title={TOOLTIPS[status]}
      role="status"
      aria-label={TOOLTIPS[status]}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: COLORS[status],
          boxShadow: `0 0 6px ${COLORS[status]}`,
          transition: 'background 200ms ease, box-shadow 200ms ease',
        }}
      />
    </span>
  );
}

/**
 * Internal polling hook. Initial state is `'warming'` so a fresh
 * load doesn't flash red before the first probe completes. Cancels
 * in-flight requests on unmount; honors the AbortController so
 * concurrent state updates from a stale fetch don't override the
 * unmounted component.
 */
function useIngestionStatus(intervalMs: number): IngestionState {
  const [state, setState] = useState<IngestionState>('warming');
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!isIngestionApiConfigured()) {
      setState('offline');
      return;
    }
    cancelledRef.current = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const url = ingestionApiUrl('/api/readyz');
        if (!url) {
          setState('offline');
          return;
        }
        const resp = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (cancelledRef.current) return;
        if (resp.status === 200) {
          const data = (await resp.json()) as ReadyzPayload;
          if (cancelledRef.current) return;
          setState(data.ready === true ? 'ready' : 'warming');
        } else if (resp.status === 503) {
          // Daemon is up but not yet ready (warming).
          setState('warming');
        } else {
          setState('offline');
        }
      } catch (err) {
        if (cancelledRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState('offline');
      } finally {
        if (!cancelledRef.current) {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    void tick();
    return () => {
      cancelledRef.current = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return state;
}
