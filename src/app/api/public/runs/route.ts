import { handlePublicRun } from "@/server/handlers";
export const runtime = "nodejs";
export function POST(request: Request) {
  return handlePublicRun(request);
}
