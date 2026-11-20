// The part of ssh2 this package uses, since ssh2 ships no types.
// @types/ssh2 would serve instead; it is not yet in the install.
declare module "ssh2" {
  import type { EventEmitter } from "node:events";
  import type { Server as NetServer } from "node:net";
  import type { Duplex, Readable, Writable } from "node:stream";

  export interface ConnectConfig {
    host: string;
    port: number;
    username: string;
    privateKey?: string | Buffer;
    readyTimeout?: number;
    hostVerifier?: (key: Buffer) => boolean;
  }

  export interface ClientChannel extends Duplex {
    readonly stderr: Readable;
    signal(name: string): boolean;
    close(): void;
    on(event: "close", listener: (code: number | null) => void): this;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: string, listener: (...args: never[]) => void): this;
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): this;
    exec(
      command: string,
      callback: (error: Error | undefined, stream: ClientChannel) => void,
    ): this;
    destroy(): this;
  }

  export interface ParsedKey {
    getPublicSSH(): Buffer;
  }

  export const utils: {
    generateKeyPairSync(type: "ed25519"): { private: string; public: string };
    parseKey(key: string | Buffer): ParsedKey | Error;
  };

  export interface AuthContext {
    readonly method: string;
    readonly key: { readonly data: Buffer };
    accept(): void;
    reject(methods?: string[]): void;
  }

  export interface ServerChannel extends Duplex {
    readonly stderr: Writable;
    exit(code: number): void;
  }

  export interface Session extends EventEmitter {
    on(
      event: "exec",
      listener: (
        accept: () => ServerChannel,
        reject: () => void,
        info: { command: string },
      ) => void,
    ): this;
  }

  export interface Connection extends EventEmitter {
    on(event: "authentication", listener: (context: AuthContext) => void): this;
    on(event: "session", listener: (accept: () => Session) => void): this;
    on(event: "ready" | "error", listener: (error?: Error) => void): this;
  }

  export class Server extends NetServer {
    constructor(
      config: { hostKeys: string[]; debug?: (message: string) => void },
      listener: (client: Connection) => void,
    );
  }
}
