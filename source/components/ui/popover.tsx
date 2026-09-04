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
        className={cn(
          "z-50 w-72 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
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
