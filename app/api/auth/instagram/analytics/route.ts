import "server-only";
import type { NextRequest } from "next/server";
import { handleInstagramAnalytics } from "../../../../lib/instagram/insights";

export async function GET(request: NextRequest) {
  return handleInstagramAnalytics(request);
}
