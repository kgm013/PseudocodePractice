// Public entry points for the pseudocode interpreter (O Level 2210 and AS Level 9618).
//
//   compile(source, level)     → errors and warnings, plus a runnable program if there are no errors
//   new Runner(program, opts)  → runs the program, pausing whenever it needs INPUT
//   runSource(source, opts)    → compile and run in one go (tests, marking on a server)

import { Diagnostics, PseudoRuntimeError } from "./diagnostics.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { lex } from "./lexer.ts";
import { parse } from "./parser.ts";
import { checkLayout } from "./layout.ts";
import { check } from "./checker.ts";
import { Machine } from "./machine.ts";
import { LEVELS } from "./levels.ts";
import type { Level } from "./levels.ts";
import type { InputRequest, RunOptions, Yielded } from "./machine.ts";
import type { Program } from "./ast.ts";

export type { Diagnostic } from "./diagnostics.ts";
export type { InputRequest, RunOptions } from "./machine.ts";
export type { Program } from "./ast.ts";
export type { Level } from "./levels.ts";
export { LEVEL_NAMES } from "./levels.ts";
export { formatReal, truncateTo, DEFAULT_STEP_LIMIT } from "./machine.ts";

export interface CompileResult {
  /** null when there is at least one error. */
  program: Program | null;
  /** Errors and warnings, sorted by line. */
  diagnostics: Diagnostic[];
}

/** Steps 1–3: lexer, layout check, parser and static checks. Nothing runs. */
export function compile(source: string, level: Level = "O"): CompileResult {
  const spec = LEVELS[level];
  const diags = new Diagnostics();
  const lines = lex(source, diags, spec);
  const program = parse(lines, diags, spec);
  checkLayout(program, lines, diags);
  // Type and scope checks need a complete program tree, so they wait until
  // the syntax is right. Otherwise one typo would cause a flood of errors.
  if (!diags.hasErrors()) check(program, diags);
  return { program: diags.hasErrors() ? null : program, diagnostics: diags.sorted() };
}

export interface RuntimeErrorInfo {
  message: string;
  line: number;
}

export type RunState =
  | { state: "input"; request: InputRequest }
  | { state: "done" }
  | { state: "error"; error: RuntimeErrorInfo };

/** Step 4: runs a compiled program. Call resume() until it is done; pass the typed value after an input request. */
export class Runner {
  private machine: Machine;
  private gen: Generator<Yielded, unknown, string | undefined>;
  private finished = false;

  constructor(program: Program, opts: RunOptions) {
    this.machine = new Machine(program, opts);
    this.gen = this.machine.run();
  }

  get steps(): number {
    return this.machine.steps;
  }

  get currentLine(): number {
    return this.machine.line;
  }

  getFiles(): Record<string, string> {
    return this.machine.getFiles();
  }

  resume(input?: string): RunState {
    if (this.finished) return { state: "done" };
    let send = input;
    try {
      for (;;) {
        const r = this.gen.next(send);
        send = undefined;
        if (r.done) {
          this.finished = true;
          return { state: "done" };
        }
        if (typeof r.value !== "number") return { state: "input", request: r.value };
      }
    } catch (e) {
      this.finished = true;
      if (e instanceof PseudoRuntimeError) return { state: "error", error: { message: e.message, line: e.line } };
      if (e instanceof RangeError) {
        return {
          state: "error",
          error: {
            message: "The program ran out of room for calls inside calls. This usually means recursion that never reaches its stopping case.",
            line: this.machine.line,
          },
        };
      }
      throw e;
    }
  }
}

export interface RunSourceResult {
  diagnostics: Diagnostic[];
  output: string[];
  runtimeWarnings: Diagnostic[];
  error: RuntimeErrorInfo | null;
  files: Record<string, string>;
  steps: number;
  /** False when the program did not compile. */
  ran: boolean;
}

/** Compiles and runs a program with a fixed list of INPUT values. */
export function runSource(
  source: string,
  options: { inputs?: string[]; level?: Level } & Partial<Omit<RunOptions, "onOutput">> = {},
): RunSourceResult {
  const { program, diagnostics } = compile(source, options.level ?? "O");
  const result: RunSourceResult = {
    diagnostics, output: [], runtimeWarnings: [], error: null, files: { ...(options.files ?? {}) }, steps: 0, ran: false,
  };
  if (!program) return result;
  result.ran = true;
  const inputs = [...(options.inputs ?? [])];
  const runner = new Runner(program, {
    ...options,
    onOutput: (t) => result.output.push(t),
    onWarning: (w) => result.runtimeWarnings.push(w),
  });
  let state = runner.resume();
  while (state.state === "input") {
    if (inputs.length === 0) {
      result.error = { message: "The program asked for more INPUT values than were given.", line: state.request.line };
      break;
    }
    state = runner.resume(inputs.shift());
  }
  if (state.state === "error") result.error = state.error;
  result.files = runner.getFiles();
  result.steps = runner.steps;
  return result;
}
