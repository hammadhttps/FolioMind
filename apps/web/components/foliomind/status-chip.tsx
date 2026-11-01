import {
  CircleCheck,
  CircleX,
  Clock,
  Info,
  LoaderCircle,
  Pencil,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Status always pairs an icon with text, never color alone (Sections 15 and 30). */
export const STATUS_STYLES = {
  ready: { label: "Ready", icon: CircleCheck, variant: "success" },
  processing: { label: "Processing", icon: LoaderCircle, variant: "info" },
  pending: { label: "Pending", icon: Clock, variant: "warning" },
  attention: { label: "Needs attention", icon: TriangleAlert, variant: "warning" },
  failed: { label: "Failed", icon: CircleX, variant: "error" },
  draft: { label: "Draft", icon: Pencil, variant: "soft" },
  info: { label: "Info", icon: Info, variant: "info" },
} as const satisfies Record<
  string,
  { label: string; icon: LucideIcon; variant: "success" | "info" | "warning" | "error" | "soft" }
>;

export type StatusKind = keyof typeof STATUS_STYLES;

export function StatusChip({
  status,
  label,
  className,
}: {
  status: StatusKind;
  label?: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={className}>
      <Icon
        aria-hidden="true"
        data-icon="inline-start"
        className={cn(status === "processing" && "motion-safe:animate-spin")}
      />
      {label ?? style.label}
    </Badge>
  );
}
