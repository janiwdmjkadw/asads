"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

/**
 * Canonical shadcn (new-york) Popover primitives, with the same
 * intentional deviation as `dialog.tsx` / `hover-card.tsx` /
 * `tooltip.tsx`: the Radix Portal mounts inside the nearest
 * `.listen-root` instead of `document.body`. The theme cascade
 * (`data-theme-id` → `--popover` / `--ink-0` / `--accent-*`) lives on
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

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const listenRoot = useListenRootContainer()
  return (
    <PopoverPrimitive.Portal container={listenRoot}>
      <PopoverPrimitive.Content
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
          "z-50 w-72 rounded-lg border border-[rgba(11,14,20,0.1)] bg-white p-4 text-[#0b0e14] shadow-[0_16px_40px_rgba(11,14,20,0.14)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
          className
        )}
        style={{ boxShadow: "var(--shadow-popover, 0 16px 32px rgba(0,0,0,0.45))" }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
