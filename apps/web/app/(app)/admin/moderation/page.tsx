import type { Metadata } from "next";
import { AdminAccessRequired, ModerationScreen } from "@/components/foliomind/screens/admin";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Content moderation" };

export default async function ModerationPage() {
  const user = await requireSessionUser();
  return user.isAdmin ? <ModerationScreen /> : <AdminAccessRequired />;
}
