import type { Metadata } from "next";
import { PublicPage } from "@/components/foliomind/public-page";
import { ExploreScreen } from "@/components/foliomind/screens/explore";

export const metadata: Metadata = {
  title: "Explore the library",
  description: "Browse books that independent publishers share on FolioMind.",
};

export default function ExplorePage() {
  return (
    <PublicPage>
      <ExploreScreen />
    </PublicPage>
  );
}
