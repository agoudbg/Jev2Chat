import { choicePayloadSchema } from "@/server/handlers";
import {
  apiBoundary,
  ApiError,
  jsonResponse,
  readBody,
  requireSameOrigin,
} from "@/server/security";
import { abortableDelay } from "@/lib/provider";
import { QUESTION_ID } from "@/lib/jev-protocol";

export function POST(request: Request) {
  return apiBoundary(async () => {
    if (process.env.NODE_ENV !== "development")
      throw new ApiError(404, "not_found", "开发 Mock 在生产环境不可用。");
    requireSameOrigin(request);
    const { input } = choicePayloadSchema.parse(await readBody(request, 262_144));
    await abortableDelay(250, request.signal);
    const text = input.candidates.filter((candidate) => candidate.kind === "text");
    const end = input.candidates.find((candidate) => candidate.kind === "end");
    const selected = input.round > 8 && end ? end : (text[(input.round - 1) % text.length] ?? end);
    if (!selected) throw new ApiError(400, "candidates", "Mock 没有可选项。");
    return jsonResponse({
      model: "MOCK-development-only",
      answers: {
        [QUESTION_ID]: {
          type: "choice",
          choice: selected.key,
          confidence: 1,
          probabilities: Object.fromEntries(
            input.candidates.map((candidate) => [
              candidate.key,
              candidate.key === selected.key ? 1 : 0,
            ]),
          ),
        },
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });
}
