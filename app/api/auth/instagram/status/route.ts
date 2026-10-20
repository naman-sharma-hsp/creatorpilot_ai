import "server-only";
import type { NextRequest } from "next/server";
import { handleInstagramStatus } from "../../../../lib/instagram/oauth-handlers";

export async function GET(request: NextRequest) {
  return handleInstagramStatus(request);
}
