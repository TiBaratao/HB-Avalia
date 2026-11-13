import { NextResponse } from "next/server";
import {
  authenticateInvitationRequest,
  cancelInvitation,
  createInvitation,
  createStoreAdminInvitation,
  getInvitationBaseUrl,
  InvitationApiError,
  listInvitations,
  readInvitationPayload,
  resendInvitation,
} from "@/lib/server/invitations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const search = new URL(request.url).searchParams;
    const companyId = search.get("companyId");
    const storeId = search.get("storeId");
    const invitations = await listInvitations(token.uid, token.email, companyId, storeId);
    return NextResponse.json({ invitations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Invitation listing failed.", error);
    return NextResponse.json({ error: "Não foi possível carregar os convites." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const payload = await readInvitationPayload(request);
    if (payload.action === "create") {
      const result = await createInvitation(token.uid, payload, getInvitationBaseUrl());
      return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (payload.action === "createStoreAdmin") {
      const result = await createStoreAdminInvitation(token.uid, token.email, payload, getInvitationBaseUrl());
      return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (payload.action === "resend") {
      const result = await resendInvitation(token.uid, token.email, payload, getInvitationBaseUrl());
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (payload.action === "cancel") {
      const result = await cancelInvitation(token.uid, token.email, payload);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    throw new InvitationApiError("Ação de convite inválida.", 400);
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Invitation management failed.", error);
    return NextResponse.json({ error: "Não foi possível processar o convite." }, { status: 500 });
  }
}
