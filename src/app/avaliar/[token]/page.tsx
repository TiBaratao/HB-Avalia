import type { Metadata } from "next";
import { CustomerFeedbackForm } from "@/components/CustomerFeedbackForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Avalie sua experiência | HB Avalia",
  description: "Compartilhe sua experiência com o supermercado.",
  robots: { index: false, follow: false },
};

export default async function PublicCustomerFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CustomerFeedbackForm token={token}/>;
}
