import { ConditionalDetailGate } from '@/components/conditionals/ConditionalDetailGate';

/**
 * One standing conditional: its journey, the plan it runs, what it has
 * fired, its versions and what you can do about it.
 *
 * This is a PAGE, not a selection. The detail used to render under the
 * ledger behind `/conditionals?id=<id>`, which left the landing's serif
 * title and its Active/History/Expired/Failed toggle sitting above a
 * surface they do not navigate — so opening a play never felt like going
 * anywhere. `?id=` still lands here: the landing redirects it.
 *
 * Same shape as the landing route, for the same reason: the surface is
 * behind the client-evaluated LaunchDarkly flag `conditionals-surface`, so
 * this server component cannot gate it with `notFound()` (see
 * `ConditionalsPageGate` for why a throw during LD's first render would
 * 404 the route for entitled users). `ConditionalDetailGate` is the client
 * child that owns the check and the id.
 */
export default function ConditionalDetailRoute() {
  return (
    <main data-conditionals-page="" className="w-full">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-4">
      <ConditionalDetailGate />
    </div>
    </main>
  );
}
