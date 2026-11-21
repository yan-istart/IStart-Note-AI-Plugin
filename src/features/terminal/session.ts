export interface TerminalSessionOptions {
  port: number;
  token: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalSessionHandlers {
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onState: (state: "connecting" | "ready" | "closed" | "error", message?: string) => void;
}

/** One WebSocket connection to the local terminal service = one PTY session. */
export class TerminalSession {
  private ws?: WebSocket;
  private fatal = "";
  private pending: Array<{ type: string; data?: string; cols?: number; rows?: number }> = [];

  constructor(private options: TerminalSessionOptions, private handlers: TerminalSessionHandlers) {}

  open(): void {
    this.handlers.onState("connecting");
    const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/terminal?token=${encodeURIComponent(this.options.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: "spawn", cwd: this.options.cwd, cols: this.options.cols, rows: this.options.rows });
    };
    ws.onmessage = event => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const typed = message as { type?: string; data?: string; code?: number; message?: string };
      if (typed.type === "ready") { this.handlers.onState("ready"); this.flush(); }
      else if (typed.type === "data" && typeof typed.data === "string") this.handlers.onData(typed.data);
      else if (typed.type === "exit") { this.handlers.onState("closed"); this.handlers.onExit(typed.code ?? 0); }
      else if (typed.type === "error") {
        // Keep the server's explanation; the socket closes right after this.
        this.fatal = typed.message || "终端启动失败";
        this.handlers.onState("error", this.fatal);
      }
    };
    ws.onclose = () => {
      if (this.fatal) return;
      this.handlers.onState("closed");
    };
    ws.onerror = () => {
      if (this.fatal) return;
      this.fatal = "终端连接失败";
      this.handlers.onState("error", this.fatal);
    };
  }

  input(data: string): void { this.send({ type: "input", data }); }
  resize(cols: number, rows: number): void { this.send({ type: "resize", cols, rows }); }

  private send(message: { type: string; data?: string; cols?: number; rows?: number; cwd?: string }): void {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(message)); return; }
    if (message.type !== "spawn") this.pending.push(message);
  }

  private flush(): void {
    for (const message of this.pending) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    }
    this.pending.length = 0;
  }

  close(): void {
    try { this.ws?.close(); } catch { /* Already closed. */ }
  }
}
