import type { NoteReference } from "../../core/agent/types";
type Handler = (content: string, reference?: NoteReference) => void;
let handler: Handler | null = null;
export function setResultConversationHandler(next: Handler | null): void { handler = next; }
export function canContinueResult(): boolean { return handler !== null; }
export function continueResult(content: string, reference?: NoteReference): void { handler?.(content, reference); }
