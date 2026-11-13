import type { Metadata } from "next";
import { InviteAcceptancePage } from "../../../components/InviteAcceptancePage";

export const metadata: Metadata = {
  title: "Aceitar convite · HB Avalia",
  robots: { index: false, follow: false },
};

export default async function InvitationPage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  return <InviteAcceptancePage invitationId={inviteId} />;
}
