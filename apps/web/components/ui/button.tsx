import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// FolioMind: 7px radius, ~38px default height, indigo primary, teal `research`
// (Approve & create draft, research CTAs) and Section 15 disabled tokens. Use
// `aria-disabled` instead of `disabled` when a tooltip must still explain why.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-button border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/70 active:not-aria-[haspopup]:not-aria-disabled:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-disabled disabled:text-disabled-foreground aria-disabled:bg-disabled aria-disabled:text-disabled-foreground",
        research:
          "bg-research text-research-foreground hover:bg-research-hover disabled:bg-disabled disabled:text-disabled-foreground aria-disabled:bg-disabled aria-disabled:text-disabled-foreground",
        outline:
          "border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-muted disabled:border-border disabled:bg-muted disabled:text-disabled-foreground aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-disabled-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary disabled:text-disabled-foreground aria-disabled:text-disabled-foreground",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted disabled:text-disabled-foreground aria-disabled:text-disabled-foreground aria-disabled:hover:bg-transparent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/25 disabled:bg-disabled disabled:text-disabled-foreground aria-disabled:bg-disabled aria-disabled:text-disabled-foreground",
        link: "h-auto px-0 text-link underline-offset-4 hover:underline aria-disabled:text-disabled-foreground aria-disabled:no-underline",
      },
      size: {
        default:
          "h-9.5 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-[0.8125rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-11 gap-2 px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9.5",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
