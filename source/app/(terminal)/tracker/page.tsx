/**
 * Tracker's UI is rendered by a persistent `PersistentTabPane` inside
 * `TerminalShell` (it stays mounted across route changes so tab switches
 * are a display flip instead of a full remount). The route page exists
 * only so /tracker is a navigable URL.
 */
export default function TrackerRoute() {
  return null;
}
