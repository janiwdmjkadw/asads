"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

/**
 * Canonical shadcn (new-york) Tooltip primitives, with one intentional
 * deviation matching `dialog.tsx`: the Radix Portal mounts inside the
 * nearest `.listen-root` instead of `document.body`. The theme cascade
 * (`data-theme-id` → `--card-bg` / `--ink-0` / `--accent-*`) lives on
 * `.listen-root`; portaling to `document.body` would render content
 * outside the cascade and lock it to the Tailwind config defaults.
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

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const listenRoot = useListenRootContainer()
  return (
    <TooltipPrimitive.Portal container={listenRoot}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          /* Second project-specific deviation from canonical shadcn:
             the upstream tooltip uses `bg-primary text-primary-foreground`
             which would tint the floating chip with our brand CTA color
             (cinnabar in zen, cyan in dark) — way too loud for an icon
             hover-label. It read `bg-popover text-popover-foreground`, and
             those tokens are the APP's, declared for a black terminal. A
             tooltip PORTALS out of whatever opened it, so the paper
             palettes the panels declare on themselves never reach it: the
             one the wallet manager's bell opens came out black over a white
             panel. Paper, stated here, because chrome this small is not
             worth a token round trip. Swapped to `bg-popover text-popover-foreground`
             (our `--surface-1` + `--ink-0` bridge in listen.css) with a
             `border` for definition. This matches the conventional
             "subtle floating chip on dark surface" look that user-research
             expects from icon tooltips. */
          "z-50 overflow-hidden rounded-md border border-[rgba(11,14,20,0.14)] bg-white px-3 py-1.5 text-xs text-[#0b0e14] shadow-[0_10px_26px_rgba(11,14,20,0.18)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
