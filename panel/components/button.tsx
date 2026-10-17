// Selective shadcn/ui Button pattern (MIT), using local shared design tokens.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const variants = cva("button", {
  variants: {
    variant: {
      default: "button-default",
      outline: "button-outline",
      ghost: "button-ghost",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Button({
  asChild = false,
  variant,
  className,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";

  return <Component className={variants({ variant, className })} {...props} />;
}
