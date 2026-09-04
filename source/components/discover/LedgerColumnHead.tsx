/**
 * The ledger's column-header strip — the one from the approved mock C.
 *
 * It renders on the SAME grid classes as the rows (`.ledger-row` +
 * variants), so the labels cannot drift off their columns: the template is
 * declared once in `discover.css` and both the head and the rows read it.
 * `.ledger-head` only re-sizes the strip (18px, its own hairline) and
 * paints the label type.
 *
 * `showMc` must be the row's own MC condition, so the label disappears
 * with the column it heads.
 */
export function LedgerColumnHead({
  showMc,
  tracker = false,
  order = 'legacy',
}: {
  showMc: boolean;
  /** true = the /tracker page's wider track variant. */
  tracker?: boolean;
  /**
   * `ageFirst` is the dock's order: age · wallet · art · token · MC ·
   * amount. `legacy` is what /tracker still renders, and it stays the
   * default — a head that reorders while its rows do not is worse than no
   * head at all.
   */
  order?: 'legacy' | 'ageFirst';
}) {
  const className = [
    'ledger-row',
    showMc ? 'ledger-row--mc' : null,
    tracker ? 'ledger-row--tracker' : null,
    'ledger-head',
  ]
    .filter(Boolean)
    .join(' ');

  if (order === 'ageFirst') {
    return (
      <div className={className}>
        <span />
        <span>Name</span>
        <span />
        <span>Token</span>
        {showMc ? <span className="ledger-head--right">MC</span> : null}
        <span className="ledger-head--right">Amount</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <span />
      <span>Wallet</span>
      <span />
      <span>Token</span>
      {showMc ? <span className="ledger-head--right">MC</span> : null}
      <span className="ledger-head--right">Size</span>
      <span className="ledger-head--right">Age</span>
    </div>
  );
}
