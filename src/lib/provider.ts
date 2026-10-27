import type { Candidate, GenerationParams, JsonValue } from "./domain";

export interface ChoiceInput {
  prompt: string;
  state: string;
  candidates: Candidate[];
  round: number;
  requestId: string;
  mode: string;
}
export interface PreparedChoice {
  input: ChoiceInput;
  question: string;
  wire: JsonValue;
}
export interface ChoiceResult {
  key: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  response: JsonValue;
}
export interface ChoiceProvider {
  readonly id: string;
  begin(params: GenerationParams, signal: AbortSignal): Promise<void>;
  prepare(input: ChoiceInput): PreparedChoice;
  choose(request: PreparedChoice, signal: AbortSignal): Promise<ChoiceResult>;
}
export class ChoiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    public readonly ambiguous = false,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "ChoiceError";
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
