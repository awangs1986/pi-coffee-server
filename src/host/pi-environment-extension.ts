import {randomUUID} from "node:crypto";
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

/** Zero-system boundary for Web Chat, including emergency mode without Harness. */
export function withoutSystemContext(payload: unknown): unknown {
  if (!record(payload)) return payload;
  const result = { ...payload };
  for (const key of ['system', 'instructions', 'systemInstruction', 'system_instruction']) delete result[key];
  for (const key of ['messages', 'input', 'contents']) {
    if (Array.isArray(result[key])) result[key] = result[key].filter((message: unknown) =>
      !record(message) || !['system', 'developer'].includes(String(message.role)));
  }
  if (record(result.config)) {
    result.config = { ...result.config };
    delete (result.config as RecordValue).systemInstruction;
    delete (result.config as RecordValue).system_instruction;
  }
  return result;
}

/** Work-only Host context; Web Chat is filtered again at the provider boundary. */
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
  let runId:string|undefined;
  pi.on("before_agent_start",(_event,ctx)=>{
    runId=randomUUID();
    try{pi.appendEntry('coffee-native-run',{version:1,runId,baselineId:ctx.sessionManager.getLeafId()});}catch{runId=undefined;}
  });
  pi.on("agent_settled",()=>{
    if(runId){try{pi.appendEntry('coffee-native-settled',{version:1,runId});}catch{/* Missing audit remains uncertain; observation never interrupts native work. */}runId=undefined;}
  });
  pi.on("before_agent_start", event => ({
    systemPrompt: process.env.PI_COFFEE_INITIAL_MODE === 'chat' ? '' : contains(event.systemPrompt) ? event.systemPrompt : append(event.systemPrompt),
  }));
  pi.on("before_provider_request", (event, ctx) => process.env.PI_COFFEE_INITIAL_MODE === 'chat' ? withoutSystemContext(event.payload) : withHostEnvironment(event.payload, ctx.model?.api));
}
