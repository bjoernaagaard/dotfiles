export type OutputStream = "stdout" | "stderr";

export type PermissionMode = "ask" | "yolo";

export interface CommandResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal?: string;
  readonly killed: boolean;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface PdxCommandDetails {
  readonly kind: "command";
  readonly service: "pitchfork" | "mise" | "fnox";
  readonly action: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly code: number | null;
  readonly killed: boolean;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly data?: unknown;
}

export interface PdxSecretDetails {
  readonly kind: "secret";
  readonly name: string;
  readonly profile?: string;
  readonly retrieved: true;
}

export type PdxToolDetails = PdxCommandDetails | PdxSecretDetails;

export interface PdxRawConfig {
  readonly enabled?: boolean;
  readonly permissionMode?: PermissionMode;
  readonly maxOutputBytes?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxLogLines?: number;
}

export interface PdxConfig {
  readonly enabled: boolean;
  readonly permissionMode: PermissionMode;
  readonly maxOutputBytes: number;
  readonly defaultTimeoutMs: number;
  readonly maxLogLines: number;
  readonly sources: readonly string[];
}
