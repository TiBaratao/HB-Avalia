import { NextResponse } from "next/server";
import {
  InvitationApiError,
  lookupInvitation,
  readInvitationPayload,
} from "@/lib/server/invitations";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readInvitationPayload(request);
    const invitation = await lookupInvitation(payload);
    return NextResponse.json(invitation, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Public invitation lookup failed.", error);
    return NextResponse.json({ error: "Não foi possível validar o convite." }, { status: 500 });
  }
}
