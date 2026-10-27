import * as React from "react";
import { cn } from "cn";

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: "default" | "editor" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        variant === "editor" &&
          "workspace-text field-sizing-fixed resize-none rounded-none border-0 bg-transparent px-6 py-5 shadow-none focus-visible:ring-inset dark:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
