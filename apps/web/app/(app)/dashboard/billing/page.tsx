import type { Metadata } from "next";
import { BillingScreen } from "@/components/foliomind/screens/billing";

export const metadata: Metadata = { title: "Billing and usage" };

export default function BillingPage() {
  return <BillingScreen />;
}
