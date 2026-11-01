import type { Metadata } from "next";
import { MyLibraryScreen } from "@/components/foliomind/screens/my-library";

export const metadata: Metadata = { title: "My Library" };

export default function MyLibraryPage() {
  return <MyLibraryScreen />;
}
