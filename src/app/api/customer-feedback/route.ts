import { NextResponse } from "next/server";
import {
  CustomerFeedbackError,
  getPublicCustomerFeedbackForm,
  submitCustomerFeedback,
} from "@/lib/server/customer-feedback-core";
import { getAdminFirestore } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    const data = await getPublicCustomerFeedbackForm(getAdminFirestore(), token);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseForError("Unable to load public customer feedback form.", error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBoundedJson(request);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return NextResponse.json({ error: "O corpo da solicitação deve ser um objeto JSON." }, { status: 400 });
    }
    const clientAddress = request.headers.get("x-real-ip")
      ?? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
      ?? "unknown";
    await submitCustomerFeedback(getAdminFirestore(), input, clientAddress);
    return NextResponse.json({ accepted: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseForError("Customer feedback submission failed.", error);
  }
}

function responseForError(context: string, error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return NextResponse.json({ error: "A avaliação enviada é muito grande." }, { status: 413 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "O corpo da solicitação deve ser um JSON válido." }, { status: 400 });
  }
  if (error instanceof CustomerFeedbackError) {
    const status = error.code === "invalid-argument" ? 400
      : error.code === "not-found" ? 404
        : error.code === "failed-precondition" ? 412
          : error.code === "resource-exhausted" ? 429
            : error.code === "permission-denied" ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error(context, error);
  return NextResponse.json({ error: "Não foi possível processar a avaliação." }, { status: 500 });
}

class RequestBodyTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 8_192) throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Missing request body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > 8_192) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
