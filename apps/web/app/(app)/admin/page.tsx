import type { Metadata } from "next";
import { AdminAccessRequired, AdminOverviewScreen } from "@/components/foliomind/screens/admin";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Admin" };

/* Checked on the server, because hidden navigation is not security (Section 4). */
export default async function AdminPage() {
  const user = await requireSessionUser();
  return user.isAdmin ? <AdminOverviewScreen /> : <AdminAccessRequired />;
}
