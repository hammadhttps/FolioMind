import type { Metadata } from "next";
import { DashboardScreen } from "@/components/foliomind/screens/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <DashboardScreen />;
}
