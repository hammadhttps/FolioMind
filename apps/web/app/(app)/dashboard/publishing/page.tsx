import type { Metadata } from "next";
import { PublishingScreen } from "@/components/foliomind/screens/publishing";

export const metadata: Metadata = { title: "Publishing" };

export default function PublishingPage() {
  return <PublishingScreen />;
}
