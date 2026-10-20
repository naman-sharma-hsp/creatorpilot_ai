import "server-only";
import type { NextRequest } from "next/server";
import { handleInstagramCallback } from "../../../../lib/instagram/oauth-handlers";

export async function GET(request: NextRequest) {
  return handleInstagramCallback(request);
}
