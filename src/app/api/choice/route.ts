import { handleChoice } from "@/server/handlers";
export const runtime = "nodejs";
export const maxDuration = 65;
export function POST(request: Request) {
  return handleChoice(request);
}
