// Checks a multiple-choice question against the interpreter: runs its code with its
// inputs and compares what happens with the answer key. Used by the import script
// (to mark questions "needs-review") and by the tests (so an interpreter change
// can't silently break a question that was fine).

import { runSource } from "../interpreter/index.ts";
import type { Level } from "../interpreter/index.ts";
import type { McqQuestion } from "./types.ts";

export interface McqVerification {
  status: "ok" | "mismatch" | "not-checkable";
  note?: string;
}

/** What actually happens when the question's code runs at this level. */
function run(question: McqQuestion, level: Level) {
  const result = runSource(question.code ?? "", { level, inputs: question.inputs ?? [], random: () => 0.5 });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) return { ok: false, why: errors[0].message };
  if (result.error) return { ok: false, why: result.error.message };
  return { ok: true, output: result.output.join("\n") };
}

export function verifyMcq(question: McqQuestion, level: Level): McqVerification {
  if (!question.code) return { status: "not-checkable", note: "No code to run." };
  if (question.resultKind === "value") return { status: "not-checkable", note: "The answer is a value, not an outcome of running the code." };

  const actual = run(question, level);

  if (question.resultKind === "invalid") {
    return actual.ok
      ? { status: "mismatch", note: `The key says invalid, but the ${level} interpreter runs it${actual.output ? ` and shows "${actual.output}"` : ""}.` }
      : { status: "ok" };
  }
  if (!actual.ok) {
    return { status: "mismatch", note: `The key says it's valid, but the ${level} interpreter rejects it: ${actual.why}` };
  }
  if (question.resultKind === "output" && actual.output !== question.resultText) {
    return { status: "mismatch", note: `The key says "${question.resultText}", but the ${level} interpreter shows "${actual.output}".` };
  }
  return { status: "ok" };
}
