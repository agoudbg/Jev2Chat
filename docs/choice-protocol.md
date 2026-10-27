# Choice protocol

Verified against the live TypeSafe documentation and OpenAPI on 2026-10-27.

- Origin: `https://api.typesafe.ai`.
- Generate a judgment: `POST /v1/systemone` with UTF-8 JSON and `Authorization: Bearer <token>`.
- Discover models: `GET /v1/models` with the same authentication. Its response contains `models[].name`.
- Body: `model`, `state`, and named `questions`. Each Choice question has `type: "choice"`, `instructions`, and a `criteria` map. Criteria descriptions may be structured JSON.
- Response: `model`, `answers.<questionId>.{type, choice, confidence, probabilities}`, and `usage.{input_tokens, output_tokens}`. `choice` contains the selected **option key**.
- A Choice supports at most **255 options**. This application requires 2–255 enabled options and refuses larger lists without modifying them.

Jev2Chat serializes one dependent question per request. `state` contains `prompt`, `generated_text`, and `granularity`. A text candidate describes `{ "action": "append", "value": "..." }`. An end candidate describes `{ "action": "finish", "marker": "EOS" }`. These descriptions are application-defined semantics accepted by the documented structured-criteria format.

```json
{
  "model": "jev-latest",
  "state": { "prompt": "Write a greeting", "generated_text": "H", "granularity": "character" },
  "questions": {
    "next_content": {
      "type": "choice",
      "instructions": "Continue generated_text to fulfill prompt. Select the next candidate, or finish.",
      "criteria": {
        "letter_i": { "action": "append", "value": "i" },
        "finish": { "action": "finish", "marker": "EOS" }
      }
    }
  }
}
```

`EOS` has no documented service-level termination semantics. It is a normal Choice option with an application-defined finish action. The generator recognizes its candidate kind and stops without appending its marker. Empty responses, missing fields, invalid keys, or inconsistent distributions are errors, never implicit termination.

The parser checks required fields, probability range, complete option coverage, and a distribution sum within 0.02 of 1 to tolerate rounded probabilities. It does not reinterpret confidence as writing quality. Token mode means user-defined string candidates; there is no undocumented model tokenizer integration or sampling-temperature parameter.

The only implemented production adapter is TypeSafe v1. Compatible mirrors may configure the origin and the two endpoint paths while retaining the same contract. OpenAI Chat Completions endpoints are not compatible. Add another `ChoiceProvider` to support a different contract without changing `ChoiceGenerator`.

The official sources confirm the transport contract, not the quality of recursive writing. Every step resubmits growing context and candidates. This can be slow, costly, repetitive, or stop early. There is no live-token acceptance claim in this project. Use a real Token and the connection test to verify your account, model availability, proxy policy, and CORS behavior.

## Sources

- [HTTP API and Bearer authentication](https://docs.typesafe.ai/api/system-one)
- [Choice request, response, structured criteria and 255-option limit](https://docs.typesafe.ai/primitives/choice)
- [Structured state](https://docs.typesafe.ai/concepts/state)
- [List models](https://docs.typesafe.ai/api/list-models)
- [Request limits and errors](https://docs.typesafe.ai/api/errors)
- [OpenAPI](https://api.typesafe.ai/openapi.json)
- [Selecting source values and copying the selected value in code](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)
