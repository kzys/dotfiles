// Learning from herdr-core when its terminals and documents change, over
// one hc connect, rather than asking it over and over.

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Applies an event of hc's events.subscribe, of type, about the terminal
 * at address, carrying data, to terminals by address. Other than created,
 * removed and foreground, an event carries the fields of the terminal it
 * changes. */
export function applyEvent(terminals: Map<string, any>, type: string, address: string | undefined, data: any) {
  if (!address) return;
  if (type === "created") return void terminals.set(address, data);
  if (type === "removed") return void terminals.delete(address);
  const terminal = terminals.get(address);
  if (!terminal) return;
  if (type === "foreground") terminal.foreground = data;
  // A lost terminal stays live while it may be started again.
  else Object.assign(terminal, data, type === "finished" ? { state: type } : {});
}

export type CoreFeedOptions = {
  /** Called with the terminals, as hc get describes them, at first and
   * after each change. */
  terminals: (terminals: any[]) => void;
  /** Called with a document's name when it changes. */
  doc: (name: string) => void;
  /** Called on each fresh subscription, after which any document may have
   * changed unseen. */
  subscribed?: () => void;
  onError?: (error: unknown) => void;
  /** Starts hc connect. */
  start?: () => ChildProcess;
  /** How long to wait to connect again after hc connect ends. */
  retryMs?: number;
  /** How long hc may say nothing, past its heartbeat every 15 seconds,
   * before it counts as gone. */
  silentMs?: number;
};

/** Follows herdr-core's terminals and documents over hc connect, starting
 * it again when it ends, falls behind or goes silent. A shell changing its
 * directory comes without an event, so its old one stays until then. */
export class CoreFeed {
  private options: CoreFeedOptions;
  private child: ChildProcess | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private silence: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  // Whether a failure has been told since the last subscription, so that
  // one that repeats, such as hc missing, is told once.
  private told = false;

  constructor(options: CoreFeedOptions) {
    this.options = options;
    this.connect();
  }

  /** Stops following. */
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.silence);
    this.child?.kill();
    this.child = null;
  }

  private connect() {
    if (this.closed) return;
    const child = (this.options.start ?? (() => spawn("hc", ["connect"], { stdio: ["pipe", "pipe", "ignore"] })))();
    this.child = child;
    const terminals = new Map<string, any>();
    const again = (wait = this.options.retryMs ?? 5000) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.silence);
      child.kill();
      this.retry = setTimeout(() => this.connect(), wait);
    };
    const heard = () => {
      clearTimeout(this.silence);
      this.silence = setTimeout(() => again(), this.options.silentMs ?? 45_000);
    };
    child.on("error", (e) => {
      if (!this.told) this.options.onError?.(e);
      this.told = true;
      again();
    });
    child.on("exit", () => again());
    child.stdin?.on("error", () => {});
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (this.child !== child) return;
      heard();
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error) {
          if (!this.told) this.options.onError?.(new Error(message.error.message));
          this.told = true;
          return again();
        }
        this.told = false;
        terminals.clear();
        for (const t of message.result?.terminals ?? []) terminals.set(t.address, t);
        this.options.subscribed?.();
        return this.options.terminals([...terminals.values()]);
      }
      // Subscribing again starts over from a snapshot.
      if (message.method === "missed") return again(0);
      if (message.method !== "event") return;
      const { type, terminal, data } = message.params ?? {};
      if (type === "doc") return this.options.doc(data?.name);
      applyEvent(terminals, type, terminal, data);
      this.options.terminals([...terminals.values()]);
    });
    heard();
    child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events.subscribe", params: {} })}\n`);
  }
}
