import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { icon: Info, className: "border-info/25 bg-info-bg text-info" },
  success: { icon: CircleCheck, className: "border-success/25 bg-success-bg text-success" },
  warning: { icon: TriangleAlert, className: "border-warning/25 bg-warning-bg text-warning" },
  error: { icon: CircleX, className: "border-error/25 bg-error-bg text-error" },
} as const;

/**
 * Inline alert (Section 19 `Alert`): icon, title and readable body on the
 * Section 15 status pairs. Errors are announced with role="alert".
 */
export function StatusAlert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border px-4 py-3.5", toneClass, className)}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm/relaxed text-foreground/85">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
