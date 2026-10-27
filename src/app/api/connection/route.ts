import { handleConnection } from "@/server/handlers";
export const runtime = "nodejs";
export const maxDuration = 65;
export function POST(request: Request) {
  return handleConnection(request);
}
