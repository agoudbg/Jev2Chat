import { clientConfig } from "@/server/config";
import { apiBoundary, jsonResponse } from "@/server/security";
export const dynamic = "force-dynamic";
export function GET() {
  return apiBoundary(async () => jsonResponse(clientConfig()));
}
