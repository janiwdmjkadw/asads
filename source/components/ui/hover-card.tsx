"use client"

import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

/**
 * Canonical shadcn (new-york) HoverCard primitives, with the same
 * intentional deviation as `tooltip.tsx` / `dialog.tsx`: the Radix
 * Portal mounts inside the nearest `.listen-root` instead of
 * `document.body`. The theme cascade (`data-theme-id` -> `--card-bg`
 * / `--ink-0` / `--accent-*`) lives on `.listen-root`; portaling to
 * `document.body` would render content outside the cascade and lock
 * it to the Tailwind config defaults.
 */
function useListenRootContainer(): HTMLElement | undefined {
  const [el, setEl] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.querySelector<HTMLElement>(".listen-root")
    setEl(root)
  }, [])
  return el ?? undefined
}

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const listenRoot = useListenRootContainer()
  return (
    <HoverCardPrimitive.Portal container={listenRoot}>
      <HoverCardPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        /*
         * PAPER, STATED HERE. `bg-popover` and `text-popover-foreground` resolve
         * through the app's tokens, which are declared for a black terminal, and
         * a portalled surface reads them from `.listen-root` rather than from
         * whatever panel opened it. So every menu on a converted page came out
         * black no matter what that page declared on itself — the wallet sound
         * picker, the tooltips and the quick chip editor all failed the same way.
         *
         * The surface is stated on the primitive instead, which is the one place
         * every dropdown in the app actually shares.
         */
        className={cn(
          /* Same surface bridge as the tooltip: `bg-popover`
             (`--surface-1`) + `border` for definition, plus the
             shared design-system entrance/exit motion utilities so
             the preview animates identically to other floating
             surfaces. */
          "z-50 w-64 rounded-md border border-[var(--ui-line)] bg-[var(--ui-paper)] p-4 text-[var(--ui-ink)] shadow-[var(--ui-shadow)] outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-hover-card-content-transform-origin]",
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
})
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }
