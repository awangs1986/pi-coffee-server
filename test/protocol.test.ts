import { describe, expect, it } from "vitest";
import { decodeClientFrame, decodeServerFrame, encodeFrame, MAX_FRAME_BYTES } from "../src/shared/protocol.js";

describe("PI Coffee wire protocol", () => {
  it("round-trips a prompt frame through the public codec", () => {
    const frame = {
      v: 1 as const,
      type: "prompt" as const,
      requestId: "req-1",
      text: "hello",
    };

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("preserves model confirmation request IDs and validates them",()=>{
    expect(decodeClientFrame(JSON.stringify({v:1,type:'get_models',requestId:'model-confirmation'}))).toEqual({v:1,type:'get_models',requestId:'model-confirmation'});
    expect(decodeClientFrame(JSON.stringify({v:1,type:'get_models'}))).toEqual({v:1,type:'get_models'});
    expect(()=>decodeClientFrame(JSON.stringify({v:1,type:'get_models',requestId:123}))).toThrow(/requestId/);
  });

  it("accepts long text within the encoded frame budget",()=>{
    const text='a'.repeat(71636);const frame={v:1 as const,type:'prompt' as const,requestId:'long-text',text};
    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("rejects frames from a different protocol version", () => {
    expect(() => decodeClientFrame(JSON.stringify({ v: 2, type: "ping", nonce: "x" }))).toThrow(
      /protocol version/i,
    );
  });

  it("rejects oversized frames before parsing them", () => {
    const oversized = `{"v":1,"type":"prompt","requestId":"r","text":"${"x".repeat(MAX_FRAME_BYTES)}"}`;
    expect(() => decodeClientFrame(oversized)).toThrow(/too large/i);
  });

  it("rejects a prompt without a non-empty request id and text", () => {
    expect(() =>
      decodeClientFrame(JSON.stringify({ v: 1, type: "prompt", requestId: "", text: "" })),
    ).toThrow(/requestId|text/i);
  });

  it("accepts the stateless sidebar command and carries history frames opaquely", () => {
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "list_sessions" }))).toEqual({ v: 1, type: "list_sessions" });
    const history = {
      v: 1 as const,
      type: "history" as const,
      sessionId: "s1",
      entries: [
        { kind: "user" as const, id: "u1", text: "hi" },
        { kind: "tool" as const, id: "c1", name: "bash", args: { command: "ls" }, result: "a", isError: false },
      ],
      leafId: "c1",
      truncated: false,
    };
    expect(decodeServerFrame(encodeFrame(history))).toEqual(history);
    const sessions = { v: 1 as const, type: "sessions" as const, sessions: [{ id: "s1", createdAt: "t", updatedAt: "t", messageCount: 2, preview: "hi", running: false }] };
    expect(decodeServerFrame(encodeFrame(sessions))).toEqual(sessions);
  });

  it("decodes the conversation-control commands and validates their fields", () => {
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "prompt", requestId: "r", text: "x", mode: "follow_up" }))).toEqual({ v: 1, type: "prompt", requestId: "r", text: "x", mode: "follow_up" });
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "prompt", requestId: "r", text: "x", mode: "prompt" }))).toEqual({ v: 1, type: "prompt", requestId: "r", text: "x" });
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "prompt", requestId: "r", text: "x", mode: "later" }))).toThrow(/mode/);
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "rename_session", name: "Plan", requestId: "n1" }))).toEqual({ v: 1, type: "rename_session", requestId: "n1", name: "Plan" });
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "rename_session", name: "" }))).toThrow(/name/);
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "delete_session", sessionId: "s1" }))).toEqual({ v: 1, type: "delete_session", sessionId: "s1" });
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "delete_session" }))).toThrow(/sessionId/);
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "set_model", provider: "cpa", id: "gpt-5.5" }))).toEqual({ v: 1, type: "set_model", provider: "cpa", id: "gpt-5.5" });
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "set_thinking", level: "high" }))).toEqual({ v: 1, type: "set_thinking", level: "high" });
    for (const type of ["get_models", "get_commands", "get_stats", "compact"]) {
      expect(decodeClientFrame(JSON.stringify({ v: 1, type }))).toEqual({ v: 1, type });
    }
  });

  it("validates extension dialog answers: exactly one of value, confirmed, cancelled", () => {
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1", value: "Allow" }))).toEqual({ v: 1, type: "ui_response", id: "u1", value: "Allow" });
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1", confirmed: false }))).toEqual({ v: 1, type: "ui_response", id: "u1", confirmed: false });
    expect(decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1", cancelled: true, requestId: "r" }))).toEqual({ v: 1, type: "ui_response", requestId: "r", id: "u1", cancelled: true });
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1" }))).toThrow(/exactly one/);
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1", value: "a", confirmed: true }))).toThrow(/exactly one/);
    expect(() => decodeClientFrame(JSON.stringify({ v: 1, type: "ui_response", id: "u1", cancelled: false }))).toThrow(/cancelled/);
  });
});
