import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HOST_ENVIRONMENT_INSTRUCTION as instruction } from "./session-instructions.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
function contains(value: unknown): boolean {
  if (typeof value === "string") return value.includes(instruction);
  if (Array.isArray(value)) return value.some(contains);
  return record(value) && ["text", "content", "parts"].some(key => contains(value[key]));
}
const append = (value: unknown) => typeof value === "string" && value ? `${value}\n${instruction}` : instruction;

/** Runs after Harness filtering: restore only Host context, never Work/runner guidance. */
export function withHostEnvironment(payload: unknown, api?: string): unknown {
  if (!record(payload)) return payload;
  const systemMessages = ["messages", "input", "contents"].flatMap(key => Array.isArray(payload[key])
    ? payload[key].filter((message: unknown) => record(message) && ["system", "developer"].includes(String(message.role))) : []);
  if ([payload.system, payload.instructions, payload.systemInstruction, payload.system_instruction,
    record(payload.config) ? payload.config.systemInstruction : undefined, ...systemMessages].some(contains)) return payload;
  if (api === "anthropic-messages" || api === "bedrock-converse-stream") {
    const block = api === "anthropic-messages" ? { type: "text", text: instruction } : { text: instruction };
    return { ...payload, system: Array.isArray(payload.system) ? [...payload.system, block]
      : typeof payload.system === "string" ? append(payload.system) : [block] };
  }
  if (Array.isArray(payload.contents)) {
    const config = record(payload.config) ? payload.config : {};
    const existing = config.systemInstruction;
    const systemInstruction = record(existing) && Array.isArray(existing.parts)
      ? { ...existing, parts: [...existing.parts, { text: instruction }] }
      : Array.isArray(existing) ? [...existing, { text: instruction }] : append(existing);
    return { ...payload, config: { ...config, systemInstruction } };
  }
  if (Array.isArray(payload.input)) return { ...payload, instructions: append(payload.instructions) };
  if (Array.isArray(payload.messages)) return { ...payload, messages: [{ role: "system", content: instruction }, ...payload.messages] };
  // Custom transports retain the native before_agent_start prompt; avoid guessing their schema.
  return payload;
}

export default function hostEnvironment(pi: ExtensionAPI): void {
  pi.on("before_agent_start", event => ({
    systemPrompt: contains(event.systemPrompt) ? event.systemPrompt : append(event.systemPrompt),
  }));
  pi.on("before_provider_request", (event, ctx) => withHostEnvironment(event.payload, ctx.model?.api));
}
