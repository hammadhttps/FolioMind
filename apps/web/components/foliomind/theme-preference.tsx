"use client";

import type { ThemePreference } from "@foliomind/contracts";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { updateTheme } from "@/lib/account/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { useIsPreview } from "./session-user";

/**
 * The signed-in user's saved appearance (user_preferences.theme) wins over the
 * browser's stored choice when the workspace loads, so it follows them across
 * devices.
 */
export function ThemePreferenceSync({ theme: saved }: { theme: ThemePreference }) {
  const { theme, setTheme } = useTheme();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || theme === undefined) return;
    applied.current = true;
    if (theme !== saved) setTheme(saved);
  }, [saved, setTheme, theme]);
  return null;
}

/** Changes the theme now and, in a signed-in workspace, saves it to the account. */
export function usePersistedTheme() {
  const { theme, setTheme } = useTheme();
  const preview = useIsPreview();
  async function choose(value: string) {
    const previous = theme;
    setTheme(value);
    if (preview) return;
    const result = await updateTheme(value).catch(() => null);
    if (result?.ok) return;
    if (result?.code === "rate_limited") {
      showRateLimitToast(result.retryAfterSeconds);
    } else {
      toast.error("We couldn't save your appearance. It will reset next time you sign in.");
    }
    if (previous && result?.code === "invalid") setTheme(previous);
  }
  return { theme, choose };
}
