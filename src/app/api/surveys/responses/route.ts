import { handleSecureActionRequest } from "@/lib/server/secure-actions-api";
import { submitSurveyResponse } from "@/lib/server/secure-actions-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSecureActionRequest(request, submitSurveyResponse);
}
