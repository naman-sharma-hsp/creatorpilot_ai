import "server-only";
import type { NextRequest } from "next/server";
import { handleInstagramAuth } from "../../../lib/instagram/oauth-handlers";

export async function GET(request: NextRequest) {
  return handleInstagramAuth(request);
}
