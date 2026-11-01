import type { Metadata } from "next";
import { MyProjectsScreen } from "@/components/foliomind/screens/my-projects";

export const metadata: Metadata = { title: "My Projects" };

export default function MyProjectsPage() {
  return <MyProjectsScreen />;
}
