import { ConditionalsPageGate } from '@/components/conditionals/ConditionalsPageGate';

/**
 * Standing conditionals: list, detail, execution timeline, cancel/resume and
 * revision lineage.
 *
 * `ConditionalsPanel` owns its own react-query key space, so nothing here can
 * re-render the chart/feed/trading surfaces (F§ invariant 4). Guidance actions
 * (`open_wallet_setup`, `refresh_authorization`) and the modification hand-off
 * are optional props; unwired, they degrade to instruction text rather than
 * dead buttons, so this route is useful before those hosts exist.
 *
 * The surface is behind the LaunchDarkly flag `conditionals-surface`, which is
 * client-evaluated — so this server component cannot gate it with `notFound()`
 * the way `app/(terminal)/agent/page.tsx` does. `ConditionalsPageGate` is the
 * client child that owns the check; with the flag off it renders nothing and
 * never loads the conditionals chunk.
 */
export default function ConditionalsRoute() {
  /*
   * The title needs air under the sub nav above it. At py-4 it sat almost
   * against the ticker strip and read as that strip's caption rather than
   * as the head of a page.
   */
  return (
    <main data-conditionals-page="" className="w-full">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 pb-4 pt-[34px]">
      <ConditionalsPageGate />
    </div>
    </main>
  );
}
