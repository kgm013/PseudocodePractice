// Marks a written answer. No React or browser code, so a server can use it unchanged.
//
// The student's code runs once per test (with that test's INPUT values and files) and its
// output is compared with the model solution's output for the same test:
//   - every expected line must appear, in order; extra lines (such as "Enter your name:"
//     prompts) are fine, unless the question sets exactOutput
//   - spaces at the ends of a line, and runs of spaces, don't matter
//   - letter case does, and so does 5 versus 5.0
// The question's mustUse / mustNotUse rules ("use a FOR loop") are checked on the code itself.
//
// The result says only correct or not. The details (outputs, errors) are kept for the
// "Reveal output" button, which shows the student's own output for the visible tests.

import { compile, runSource } from "../interpreter/index.ts";
import type { Level } from "../interpreter/index.ts";
import type { WrittenQuestion, WrittenTest } from "./types.ts";

export interface TestRun {
  testId: string;
  hidden: boolean;
  inputs: string[];
  output: string[]; // what the student's program displayed
  error: string | null; // a runtime error, e.g. "asked for more INPUT values than were given"
  passed: boolean;
}

export interface WrittenCheck {
  correct: boolean;
  compileErrors: { line: number; message: string }[];
  ruleFailures: string[];
  runs: TestRun[];
}

const STEP_LIMIT = 500_000; // generous for exam-style programs, quick to stop an endless loop

const tidy = (line: string) => line.trim().replace(/\s+/g, " ");

/** Whether the program's output contains the expected lines (see the rules at the top). */
export function outputMatches(actual: string[], expected: string[], exact = false): boolean {
  const a = actual.map(tidy);
  const e = expected.map(tidy);
  if (exact) return a.length === e.length && a.every((line, i) => line === e[i]);
  let j = 0;
  for (const line of a) if (j < e.length && line === e[j]) j++;
  return j === e.length;
}

// ---- mustUse / mustNotUse ------------------------------------------------------

const STATEMENT_KINDS: Record<string, string> = {
  DECLARE: "declare",
  CONSTANT: "constant",
  INPUT: "input",
  OUTPUT: "output",
  IF: "if",
  CASE: "case",
  FOR: "for",
  WHILE: "while",
  REPEAT: "repeat",
  PROCEDURE: "procedure",
  FUNCTION: "function",
  CALL: "call",
  RETURN: "return",
  OPENFILE: "openfile",
  READFILE: "readfile",
  WRITEFILE: "writefile",
  CLOSEFILE: "closefile",
};

/** Every statement kind and built-in function used anywhere in a program. */
function constructsIn(program: unknown): Set<string> {
  const found = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Record<string, unknown>;
    if (typeof n.k === "string") {
      found.add(n.k);
      if (n.k === "builtin" && typeof n.name === "string") found.add(`builtin:${n.name.toUpperCase()}`);
    }
    for (const [key, value] of Object.entries(n)) {
      // Skip the checker's links back to symbols, which aren't part of the code itself.
      if (key !== "sym" && key !== "ref" && key !== "sub" && key !== "globals" && key !== "subs") visit(value);
    }
  };
  visit(program);
  return found;
}

function uses(constructs: Set<string>, rule: string): boolean {
  const name = rule.toUpperCase();
  if (name === "ARRAY") return constructs.has("array");
  if (name in STATEMENT_KINDS) return constructs.has(STATEMENT_KINDS[name]);
  return constructs.has(`builtin:${name}`); // DIV, MOD, ROUND, LENGTH, SUBSTRING, ...
}

/** The rule words a question may use in mustUse / mustNotUse (anything else is a built-in name). */
export const RULE_WORDS = [...Object.keys(STATEMENT_KINDS), "ARRAY"];

// ---- Marking ----------------------------------------------------------------------

function run(code: string, test: WrittenTest, level: Level) {
  const result = runSource(code, {
    level,
    inputs: test.inputs ?? [],
    files: test.files ?? {},
    random: () => 0.5,
    stepLimit: STEP_LIMIT,
  });
  const error = result.diagnostics.find((d) => d.severity === "error")?.message ?? result.error?.message ?? null;
  return { output: result.output, error };
}

/** The lines a test expects: given in the data, or else what the model solution displays. */
export function expectedFor(question: WrittenQuestion, test: WrittenTest, level: Level): string[] {
  if (test.expected) return test.expected;
  const withHarness = question.harness ? `${question.solution}\n${question.harness}` : question.solution;
  const solved = run(withHarness, test, level);
  if (solved.error) throw new Error(`${question.id}: the model solution fails test ${test.id} at ${level}: ${solved.error}`);
  return solved.output;
}

export function checkWritten(question: WrittenQuestion, code: string, level: Level): WrittenCheck {
  const full = question.harness ? `${code}\n${question.harness}` : code;
  const compiled = compile(full, level);
  const compileErrors = compiled.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => ({ line: d.line, message: d.message }));

  const ruleFailures: string[] = [];
  if (compiled.program) {
    const used = constructsIn(compiled.program);
    for (const rule of question.mustUse ?? []) if (!uses(used, rule)) ruleFailures.push(`Use ${rule} in your answer.`);
    for (const rule of question.mustNotUse ?? []) if (uses(used, rule)) ruleFailures.push(`Don't use ${rule} in this answer.`);
  }

  const runs: TestRun[] = question.tests.map((test) => {
    const base = { testId: test.id, hidden: Boolean(test.hidden), inputs: test.inputs ?? [] };
    if (compileErrors.length) return { ...base, output: [], error: null, passed: false };
    const actual = run(full, test, level);
    const passed = !actual.error && outputMatches(actual.output, expectedFor(question, test, level), question.exactOutput);
    return { ...base, output: actual.output, error: actual.error, passed };
  });

  return {
    correct: compileErrors.length === 0 && ruleFailures.length === 0 && runs.every((r) => r.passed),
    compileErrors,
    ruleFailures,
    runs,
  };
}
