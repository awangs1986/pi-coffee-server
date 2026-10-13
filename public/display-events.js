/** Shared display semantics; lifecycle, questions and errors are never transcript bodies. */
export function isToolExecutionEvent(event) {
  return ['tool_update','tool_execution_start','tool_execution_update','tool_execution_end'].includes(event?.type);
}
export function isTranscriptEvent(event) {
  return isToolExecutionEvent(event) || ['sync_entity','message_start','message_update','message_end','message_delta','message_completed'].includes(event?.type);
}
export function isProcessEvent(event) {
  return isToolExecutionEvent(event) || (event?.type==='sync_entity' && event?.entry?.kind==='tool');
}
