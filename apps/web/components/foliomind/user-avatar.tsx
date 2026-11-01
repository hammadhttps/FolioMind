import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { SessionUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0]?.[0], parts.at(-1)?.[0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

export function UserAvatar({
  user,
  className,
}: {
  user: Pick<SessionUser, "name" | "picture">;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {user.picture ? <AvatarImage src={user.picture} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-primary-subtle text-xs font-semibold text-primary-subtle-foreground">
        {initialsOf(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}
