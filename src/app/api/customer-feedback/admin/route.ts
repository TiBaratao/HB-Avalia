import { handleSecureActionRequest } from "@/lib/server/secure-actions-api";
import { manageCustomerFeedback } from "@/lib/server/customer-feedback-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleSecureActionRequest(request, manageCustomerFeedback, 200);
}
