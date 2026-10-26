import { NextResponse } from "next/server";
import {
  authenticatePromotionRequest,
  decidePromotionRequest,
  PromotionApiError,
  readPromotionPayload,
} from "@/lib/server/promotion-actions";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const uid = await authenticatePromotionRequest(request);
    const { requestId } = await context.params;
    if (!requestId || requestId.includes("/")) {
      throw new PromotionApiError("Indicação inválida.", 400);
    }
    const payload = await readPromotionPayload(request);
    const result = await decidePromotionRequest(uid, requestId, payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PromotionApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Promotion decision endpoint failed.", error);
    return NextResponse.json({ error: "Não foi possível registrar a decisão da indicação." }, { status: 500 });
  }
}
