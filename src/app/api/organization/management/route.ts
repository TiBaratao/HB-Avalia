import { NextResponse } from "next/server";
import {
  authenticateInvitationRequest,
  InvitationApiError,
  readInvitationPayload,
} from "@/lib/server/invitations";
import {
  readOrganizationManagement,
  transferOrganizationMember,
} from "@/lib/server/organization-management";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const result = await readOrganizationManagement(token.uid, token.email);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Organization management listing failed.", error);
    return NextResponse.json({ error: "Não foi possível carregar a gestão organizacional." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const payload = await readInvitationPayload(request);
    if (payload.action !== "transfer") throw new InvitationApiError("Ação organizacional inválida.", 400);
    const result = await transferOrganizationMember(token.uid, token.email, payload);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Organization member transfer failed.", error);
    return NextResponse.json({ error: "Não foi possível transferir o usuário." }, { status: 500 });
  }
}
