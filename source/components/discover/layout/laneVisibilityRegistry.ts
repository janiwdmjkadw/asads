/**
 * Pure bookkeeping for a `CardLane`'s viewport-visibility tracking, factored
 * out of the React component so it can be unit-tested without a DOM.
 *
 * It maps each registered slot element to a visibility callback and bridges an
 * `IntersectionObserver` (attached later, once the scroll root exists) to those
 * callbacks. Attaching an observer (re)observes every currently-registered
 * element -- this is what lets child slots register during mount while the
 * parent lane creates the observer in its effect (which runs after), and makes
 * a detach/reattach correct without any extra queue.
 */

/** The slice of `IntersectionObserver` this registry drives (observe/unobserve). */
export interface ObserverLike {
  observe(el: Element): void;
  unobserve(el: Element): void;
}

/** The slice of `IntersectionObserverEntry` this registry reads. */
export interface VisibilityEntry {
  target: Element;
  isIntersecting: boolean;
}

export interface LaneVisibilityRegistry {
  /** Track `el`; `onChange(visible)` fires on each intersection change. Returns an unregister fn. */
  register(el: Element, onChange: (visible: boolean) => void): () => void;
  /** Attach the observer (flushing any queued elements) or detach with `null`. */
  setObserver(observer: ObserverLike | null): void;
  /** Fan a batch of observer entries out to the matching callbacks. */
  handleEntries(entries: ReadonlyArray<VisibilityEntry>): void;
}

export function createLaneVisibilityRegistry(): LaneVisibilityRegistry {
  const callbacks = new Map<Element, (visible: boolean) => void>();
  let observer: ObserverLike | null = null;

  return {
    register(el, onChange) {
      callbacks.set(el, onChange);
      observer?.observe(el);
      return () => {
        callbacks.delete(el);
        observer?.unobserve(el);
      };
    },

    setObserver(next) {
      observer = next;
      if (!next) return;
      // Observe everything registered so far (slots that mounted before the
      // observer existed), and re-observe on any reattach.
      for (const el of callbacks.keys()) next.observe(el);
    },

    handleEntries(entries) {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry.isIntersecting);
      }
    },
  };
}
