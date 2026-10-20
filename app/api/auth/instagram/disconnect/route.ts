import "server-only";
import type { NextRequest } from "next/server";
import { handleInstagramDisconnect } from "../../../../lib/instagram/oauth-handlers";

export async function POST(request: NextRequest) {
  return handleInstagramDisconnect(request);
}

export async function DELETE(request: NextRequest) {
  return handleInstagramDisconnect(request);
}
