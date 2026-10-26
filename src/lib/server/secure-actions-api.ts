import "server-only";

import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import {
  SecureActionError,
  type SecureActionResult,
} from "./secure-actions-core";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin";

type JsonObject = Record<string, unknown>;
type SecureAction = (db: Firestore, uid: string, payload: JsonObject) => Promise<SecureActionResult>;

export async function handleSecureActionRequest(request: Request, action: SecureAction) {
  try {
    const uid = await authenticateRequest(request);
    const payload = await readPayload(request);
    return NextResponse.json(await action(getAdminFirestore(), uid, payload), { status: 201 });
  } catch (error) {
    if (error instanceof SecureActionError) {
      return NextResponse.json({ error: error.message }, { status: statusForCode(error.code) });
    }
    console.error("Secure action request failed.", error);
    return NextResponse.json({ error: "Não foi possível processar a solicitação." }, { status: 500 });
  }
}

async function authenticateRequest(request: Request): Promise<string> {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new SecureActionError("unauthenticated", "Faça login para continuar.");

  try {
    return (await getAdminAuth().verifyIdToken(match[1], true)).uid;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && error.code.startsWith("auth/")) {
      throw new SecureActionError("unauthenticated", "Sua sessão expirou. Entre novamente para continuar.");
    }
    throw error;
  }
}

async function readPayload(request: Request): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new SecureActionError("invalid-argument", "O corpo da solicitação deve ser um JSON válido.");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SecureActionError("invalid-argument", "O corpo da solicitação deve ser um objeto JSON.");
  }
  return payload as JsonObject;
}

function statusForCode(code: string): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "permission-denied":
      return 403;
    case "already-exists":
      return 409;
    case "failed-precondition":
      return 412;
    case "invalid-argument":
      return 400;
    default:
      return 500;
  }
}
