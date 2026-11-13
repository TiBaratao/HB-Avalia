import { NextResponse } from "next/server";
import {
  acceptInvitation,
  authenticateInvitationRequest,
  InvitationApiError,
  readInvitationPayload,
} from "@/lib/server/invitations";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const payload = await readInvitationPayload(request);
    const result = await acceptInvitation(token.uid, token.email, token.email_verified === true, payload);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Invitation acceptance failed.", error);
    return NextResponse.json({ error: "Não foi possível aceitar o convite." }, { status: 500 });
  }
}
