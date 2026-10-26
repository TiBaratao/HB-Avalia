import { NextResponse } from "next/server";
import {
  authenticatePromotionRequest,
  PromotionApiError,
  readPromotionPayload,
  submitPromotionRequest,
} from "@/lib/server/promotion-actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await authenticatePromotionRequest(request);
    const payload = await readPromotionPayload(request);
    const result = await submitPromotionRequest(uid, payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PromotionApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Promotion request endpoint failed.", error);
    return NextResponse.json({ error: "Não foi possível processar a indicação de promoção." }, { status: 500 });
  }
}
