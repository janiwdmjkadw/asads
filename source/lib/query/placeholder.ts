/**
 * `keepPreviousData` scoped to a single mint.
 *
 * Plain `keepPreviousData` on a mint-keyed query spans MINT changes: on a
 * fast token-to-token navigation the previous mint's rows render under the
 * new mint's URL until the new fetch lands. This variant keeps the previous
 * page visible only when the previous query belonged to the SAME mint
 * (pagination / refreshKey churn stay stale-while-revalidate) and drops the
 * placeholder entirely across mints.
 *
 * The responses don't echo the mint, so the check keys off query-key meta:
 * `mintIndex` is the position of the mint in the query key.
 */
export function keepPreviousDataForMint(
  mint: string | null | undefined,
  mintIndex: number,
): <TData>(
  previousData: TData | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
) => TData | undefined {
  // Generic in the data slot (exactly like react-query's own
  // `keepPreviousData`) so `useQuery` never infers TData from the
  // placeholder function instead of the queryFn.
  return <TData,>(
    previousData: TData | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
  ): TData | undefined => {
    if (previousData === undefined || previousQuery == null) return undefined;
    return previousQuery.queryKey[mintIndex] === mint ? previousData : undefined;
  };
}
