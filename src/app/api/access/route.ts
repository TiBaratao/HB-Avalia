import { NextResponse } from "next/server";
import {
  authenticateInvitationRequest,
  InvitationApiError,
  readCurrentAccess,
} from "@/lib/server/invitations";
import { DirectorAccessError, readDirectorAccess } from "@/lib/server/director-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = await authenticateInvitationRequest(request);
    const directorAccess = await readDirectorAccess(token.uid, token.email);
    const access = directorAccess
      ?? { accessType: "COMPANY" as const, ...await readCurrentAccess(token.uid, token.email) };
    return NextResponse.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof DirectorAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Access check failed.", error);
    return NextResponse.json({ error: "Não foi possível validar seu acesso." }, { status: 500 });
  }
}
