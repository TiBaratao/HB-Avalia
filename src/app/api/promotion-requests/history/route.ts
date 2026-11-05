import { NextResponse } from "next/server";
import {
  authenticatePromotionRequest,
  listPromotionHistory,
  PromotionApiError,
} from "@/lib/server/promotion-actions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const uid = await authenticatePromotionRequest(request);
    const search = new URL(request.url).searchParams;
    const result = await listPromotionHistory(uid, search.get("companyId"), search.get("employeeId"));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PromotionApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Promotion history endpoint failed.", error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico de promoções." }, { status: 500 });
  }
}
