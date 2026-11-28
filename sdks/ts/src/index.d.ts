export interface RilDiagnostic {
  kind: string;
  message: string;
  line?: number;
  column?: number;
  hint?: string;
}
export interface RilMachineResult {
  id: string;
  states_explored: number;
  invariants_checked: number;
  liveness_checked: number;
}
export interface RilProofResult {
  id: string;
  proves: string;
  cases_checked: number;
}
export interface RilTestCase {
  id: string;
  law: string;
  verdict: string;
}
export interface RilCheckResult {
  ok: boolean;
  name?: string;
  version?: number;
  digest?: string;
  laws?: number;
  promises?: number;
  machines: RilMachineResult[];
  proofs: RilProofResult[];
  tests: RilTestCase[];
  /** Structured failures (parse/law/machine/proof/test/io). Empty when ok. */
  diagnostics: RilDiagnostic[];
  /** The untouched JSON object the CLI printed. */
  raw: Record<string, unknown>;
}
export interface RilTestResult {
  ok: boolean;
  passed: number;
  tests: RilTestCase[];
  diagnostics: RilDiagnostic[];
  raw: Record<string, unknown>;
}
export interface RilClientOptions {
  /** Path to the `ril` binary. Defaults to $RIL_BIN, then `ril` on PATH. */
  bin?: string;
}
export class RilError extends Error {
  constructor(message: string, details?: { stdout?: string; stderr?: string; status?: number | null });
  stdout: string;
  stderr: string;
  status: number | null;
}
export interface RilEvaluateOptions {
  actor?: string;
  resource?: string;
  context?: Record<string, unknown>;
  entities?: string[];
}
export interface RilEvaluateResult {
  verdict: "allow" | "deny" | "hold";
  laws: string[];
  errors: Record<string, unknown>;
  lawSetDigest: string;
  raw: Record<string, unknown>;
}
export class RilClient {
  constructor(opts?: RilClientOptions);
  readonly bin: string;
  check(filePath: string): RilCheckResult;
  test(filePath: string): RilTestResult;
  codegen(filePath: string, lang: "rust" | "ts", outPath?: string): string;
  spec(): string;
  /**
   * `publicKeyHex` may be a 32-byte Ed25519 key as 64 hex chars, PEM text,
   * or a path to a PEM file.
   */
  verifyReceipt(receiptPath: string, publicKeyHex: string): { ok: boolean; output: string };
  evaluate(lawFile: string, action: string, opts?: RilEvaluateOptions): RilEvaluateResult;
}

// AI Agent Middleware
export class RilDeniedError extends Error {
  constructor(verdict: string, action: string, reason: string, matchedLaw: string | null, decision: RilEvaluateResult);
  verdict: string;
  action: string;
  reason: string;
  matchedLaw: string | null;
  decision: RilEvaluateResult;
}
export class RilApprovalRequiredError extends Error {
  constructor(verdict: string, action: string, reason: string, matchedLaw: string | null, decision: RilEvaluateResult);
  verdict: string;
  action: string;
  reason: string;
  matchedLaw: string | null;
  decision: RilEvaluateResult;
}
export interface GovernToolOptions {
  client: RilClient;
  lawFile: string;
  action: string;
  actor?: string;
  mapContext?: (...args: any[]) => Record<string, unknown>;
  onAsk?: (decision: RilEvaluateResult, args: any[]) => boolean | Promise<boolean>;
  onDecision?: (decision: RilEvaluateResult, args: any[]) => void | Promise<void>;
}
export function governTool<T extends (...args: any[]) => any>(fn: T, options: GovernToolOptions): (...args: Parameters<T>) => Promise<ReturnType<T>>;
export interface WrapToolsOptions extends Omit<GovernToolOptions, 'action'> {
  actionPrefix?: string;
  actionMap?: Record<string, string>;
}
export type Tool = ((...args: any[]) => any) | { execute: (...args: any[]) => any; [key: string]: any };
export function wrapTools<T extends Record<string, Tool>>(tools: T, options: WrapToolsOptions): T;
