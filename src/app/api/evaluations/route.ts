import { handleSecureActionRequest } from "@/lib/server/secure-actions-api";
import { submitEvaluation } from "@/lib/server/secure-actions-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSecureActionRequest(request, submitEvaluation);
}
