// Imports multiple-choice questions from LaTeX worksheets into shared/practice/data/.
//
//   node scripts/import-mcq-tex.ts <questions-folder> <solutions-folder> [--source id] [--title "..."]
//
// Pairs files by name: pseudocode_03_input_questions.tex + pseudocode_03_input_solutions.tex
// ("input" is the topic slug). For each question it reads the prompt, code, options,
// answer, result and explanation, then:
//   - keeps the question's ID if it was imported before (matched on source + question
//     number), otherwise gives it the next unused ID: mcq-<slug>-001, -002, ...
//   - checks it against the interpreter at every level it's placed at, and marks it
//     "needs-review" (with the reason) when the interpreter disagrees with the answer key
//   - places new questions in the topic with the same slug at every level
// Existing placements are kept, so unlinking a question from a level survives a re-import.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyMcq } from "../shared/practice/verifyMcq.ts";
import type { Level, McqPlacement, McqQuestion, Source, Topic } from "../shared/practice/types.ts";

const DATA = new URL("../shared/practice/data/", import.meta.url);
const path = (p: string) => new URL(p, DATA);

// ---- Arguments ----------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [questionsDir, solutionsDir] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!questionsDir || !solutionsDir) {
  console.error('Usage: node scripts/import-mcq-tex.ts <questions-folder> <solutions-folder> [--source id] [--title "..."]');
  process.exit(1);
}
const sourceId = flag("source", "four-lessons");
const sourceTitle = flag("title", "Pseudocode Practice Worksheet: four lessons");

// ---- LaTeX to plain text --------------------------------------------------------

/** The text of the {...} group starting at s[i] (which must be "{"), and the index after it. */
function readGroup(s: string, i: number): [string, number] {
  if (s[i] !== "{") throw new Error(`Expected "{" at ${i}: ${s.slice(i, i + 40)}`);
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  throw new Error(`Unclosed group at ${i}`);
}

const ESCAPES: Record<string, string> = { _: "_", "&": "&", "%": "%", "#": "#", $: "$", "{": "{", "}": "}", " ": " " };
const SYMBOLS: Record<string, string> = { textquotesingle: "'", textbar: "|", textbackslash: "\\", textasciitilde: "~" };

/** Converts LaTeX text to plain text. \texttt{...} becomes `...` (code) unless inCode. */
function latexToText(s: string, inCode = false): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "\\") {
      const name = /^[a-zA-Z]+/.exec(s.slice(i + 1))?.[0];
      if (!name) {
        const ch = s[i + 1];
        if (!(ch in ESCAPES)) throw new Error(`Unknown escape \\${ch} in: ${s}`);
        out += ESCAPES[ch];
        i += 2;
        continue;
      }
      i += 1 + name.length;
      if (name in SYMBOLS) {
        if (s.startsWith("{}", i)) i += 2;
        out += SYMBOLS[name];
        continue;
      }
      if (!["texttt", "textbf", "textit", "emph"].includes(name)) throw new Error(`Unsupported command \\${name} in: ${s}`);
      const [inner, next] = readGroup(s, i);
      i = next;
      if (name === "texttt" && !inCode) out += "`" + latexToText(inner, true) + "`";
      else out += latexToText(inner, inCode);
      continue;
    }
    if (c === "{" || c === "}") {
      i++;
      continue;
    }
    if (!inCode && s.startsWith("``", i)) {
      out += '"';
      i += 2;
      continue;
    }
    if (!inCode && s.startsWith("''", i)) {
      out += '"';
      i += 2;
      continue;
    }
    if (!inCode && s.startsWith("--", i)) {
      out += "–";
      i += s.startsWith("---", i) ? 3 : 2;
      continue;
    }
    if (c === "~") {
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return inCode ? out : out.replace(/\s+/g, " ").trim();
}

/** Code blocks use <- for assignment; the site shows ← like the exam papers (not inside strings). */
function tidyCode(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/("[^"]*"|'[^']*')|<-/g, (m, str) => str ?? "←").trimEnd())
    .join("\n")
    .trim();
}

// ---- Parsing the sheets ----------------------------------------------------------

interface ParsedQuestion {
  number: number;
  prompt: string;
  code?: string;
  options: { id: string; text: string }[];
}

function parseQuestions(tex: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  const starts = [...tex.matchAll(/\\bfseries Q(\d+)\.\}/g)];
  for (const m of starts) {
    const from = m.index! + m[0].length;
    const block = tex.slice(from, tex.indexOf("\\end{minipage}", from));

    const promptAt = block.indexOf("\\textbf{");
    const [promptTex] = readGroup(block, promptAt + "\\textbf".length);

    const code = /\\begin\{lstlisting\}(?:\[[^\]]*\])?\n([\s\S]*?)\n?\\end\{lstlisting\}/.exec(block)?.[1];

    // The options table: skip \begin{tabularx}{width}{columns}, then read up to \end{tabularx}.
    let at = block.indexOf("\\begin{tabularx}") + "\\begin{tabularx}".length;
    at = readGroup(block, at)[1];
    at = readGroup(block, at)[1];
    const table = block.slice(at, block.indexOf("\\end{tabularx}", at));
    const marks = [...table.matchAll(/\\textbf\{([A-F])\.\}/g)];
    const options = marks.map((mark, k) => {
      const end = k + 1 < marks.length ? marks[k + 1].index! : table.length;
      const raw = table.slice(mark.index! + mark[0].length, end).replace(/\\\\\s*$/, "").replace(/&\s*$/, "").trim();
      return { id: mark[1].toLowerCase(), text: latexToText(raw) };
    });

    out.push({ number: Number(m[1]), prompt: latexToText(promptTex), code: code ? tidyCode(code) : undefined, options });
  }
  return out;
}

interface ParsedSolution {
  answer: string;
  resultKind: McqQuestion["resultKind"];
  resultText: string;
  explanation: string;
}

function parseSolutions(tex: string): Map<number, ParsedSolution> {
  const out = new Map<number, ParsedSolution>();
  for (const line of tex.split("\n")) {
    const m = /^(\d+) & \\textbf\{([A-F])\} & (.*?) & (.*?)\s*\\ \\\\\s*$/.exec(line.trim());
    if (!m) continue;
    const cell = m[3].trim();
    let resultKind: McqQuestion["resultKind"];
    let resultText: string;
    if (cell.startsWith("\\texttt")) {
      resultKind = "output"; // refined to "value" below when the code has no OUTPUT
      resultText = latexToText(readGroup(cell, "\\texttt".length)[0], true);
    } else {
      resultText = latexToText(cell);
      if (/^Invalid/i.test(resultText)) resultKind = "invalid";
      else if (/^Valid/i.test(resultText)) resultKind = "valid";
      else throw new Error(`Question ${m[1]}: unknown result "${cell}"`);
    }
    out.set(Number(m[1]), { answer: m[2].toLowerCase(), resultKind, resultText, explanation: latexToText(m[4]) });
  }
  return out;
}

// ---- Existing data ------------------------------------------------------------------

const readJson = <T>(p: string, fallback: T): T => (existsSync(path(p)) ? JSON.parse(readFileSync(path(p), "utf8")) : fallback);
const writeJson = (p: string, value: unknown) => writeFileSync(path(p), JSON.stringify(value, null, 2) + "\n");

const levels = readJson<Level[]>("levels.json", []);
const topics = readJson<Topic[]>("topics.json", []);
const sources = readJson<Source[]>("sources.json", []);
let placements = readJson<McqPlacement[]>("mcq/placements.json", []);
const knownIds = existsSync(path("known-ids.txt"))
  ? readFileSync(path("known-ids.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  : [];
mkdirSync(path("mcq/questions/"), { recursive: true });

if (!sources.some((s) => s.id === sourceId)) sources.push({ id: sourceId, title: sourceTitle, kind: "worksheet" });

// ---- Import --------------------------------------------------------------------------

const report: string[] = [];
const newIds: string[] = [];

const files = readdirSync(questionsDir).filter((f) => /_questions\.tex$/.test(f)).sort();
for (const file of files) {
  const slug = /^pseudocode_\d+_(.+)_questions\.tex$/.exec(file)?.[1];
  if (!slug) throw new Error(`Can't work out the topic from "${file}"`);
  const solutionFile = join(solutionsDir, file.replace("_questions.tex", "_solutions.tex"));
  const parsed = parseQuestions(readFileSync(join(questionsDir, file), "utf8"));
  const solutions = parseSolutions(readFileSync(solutionFile, "utf8"));
  const placedTopics = topics.filter((t) => t.slug === slug);
  if (!placedTopics.length) throw new Error(`No topic with slug "${slug}" in topics.json`);

  const bankFile = `mcq/questions/${slug}.json`;
  const existing = readJson<McqQuestion[]>(bankFile, []);
  const bySource = new Map(existing.map((q) => [`${q.sourceId}:${q.sourceRef}`, q]));
  const prefix = `mcq-${slug}-`;
  let nextNumber = 1 + Math.max(0, ...[...knownIds, ...existing.map((q) => q.id)].filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length))));

  const imported: McqQuestion[] = [];
  for (const p of parsed) {
    const sol = solutions.get(p.number);
    if (!sol) throw new Error(`${file}: no solution for Q${p.number}`);
    if (!p.options.some((o) => o.id === sol.answer)) throw new Error(`Q${p.number}: answer ${sol.answer} isn't an option`);

    const sourceRef = `Q${p.number}`;
    const before = bySource.get(`${sourceId}:${sourceRef}`);
    const id = before?.id ?? `${prefix}${String(nextNumber++).padStart(3, "0")}`;
    if (!before) newIds.push(id);

    const inputs = /^The user enters (.+?)\. /.exec(p.prompt)?.[1];
    const resultKind = sol.resultKind === "output" && !/\bOUTPUT\b/.test(p.code ?? "") ? "value" : sol.resultKind;

    const q: McqQuestion = {
      id,
      version: before?.version ?? 1,
      sourceId,
      sourceRef,
      prompt: p.prompt,
      ...(p.code ? { code: p.code } : {}),
      ...(inputs ? { inputs: [inputs] } : {}),
      options: p.options,
      answer: sol.answer,
      resultKind,
      resultText: sol.resultText,
      explanation: sol.explanation,
      reviewStatus: "ok",
    };
    // Bump the version when the question itself changed since the last import.
    if (before) {
      const sameContent = JSON.stringify([before.prompt, before.code, before.options, before.answer]) === JSON.stringify([q.prompt, q.code, q.options, q.answer]);
      if (!sameContent) q.version = before.version + 1;
    }

    // The chosen option should say the same as the answer key's result.
    const chosen = p.options.find((o) => o.id === sol.answer)!.text;
    const notes: string[] = [];
    if (resultKind === "output" && chosen !== "`" + sol.resultText + "`") {
      notes.push(`The answer key's result "${sol.resultText}" doesn't match option ${sol.answer.toUpperCase()} (${chosen}).`);
    }
    for (const level of new Set(placedTopics.map((t) => levels.find((l) => l.id === t.levelId)!.interpreterLevel))) {
      const v = verifyMcq(q, level);
      if (v.status === "mismatch") notes.push(v.note!);
    }
    if (notes.length) {
      q.reviewStatus = "needs-review";
      q.reviewNote = notes.join(" ");
      report.push(`${id} (${sourceRef}): ${q.reviewNote}`);
    }
    imported.push(q);
  }

  // Keep questions from other sources in this file; replace this source's.
  const kept = existing.filter((q) => q.sourceId !== sourceId);
  const merged = [...kept, ...imported].sort((a, b) => a.id.localeCompare(b.id));
  writeJson(bankFile, merged);

  // Place new questions in every topic with this slug; keep existing placements as they are.
  for (const topic of placedTopics) {
    let order = Math.max(0, ...placements.filter((pl) => pl.topicId === topic.id).map((pl) => pl.order));
    for (const q of imported) {
      if (!newIds.includes(q.id) || placements.some((pl) => pl.questionId === q.id && pl.topicId === topic.id)) continue;
      placements.push({ topicId: topic.id, questionId: q.id, order: ++order });
    }
  }
  console.log(`${slug}: ${imported.length} questions (${imported.filter((q) => q.reviewStatus === "needs-review").length} need review)`);
}

placements = placements.sort((a, b) => a.topicId.localeCompare(b.topicId) || a.order - b.order);
writeJson("mcq/placements.json", placements);
writeJson("sources.json", sources);

if (newIds.length) {
  // New IDs go above the "# Retired" section.
  const text = existsSync(path("known-ids.txt")) ? readFileSync(path("known-ids.txt"), "utf8") : "\n# Retired\n";
  const at = text.indexOf("\n# Retired");
  const active = (at >= 0 ? text.slice(0, at) : text).replace(/\s*$/, "\n");
  const retired = at >= 0 ? text.slice(at) : "\n# Retired\n";
  writeFileSync(path("known-ids.txt"), active + newIds.join("\n") + "\n" + retired.replace(/^\n*/, "\n"));
}

console.log(`\n${newIds.length} new IDs, ${placements.length} placements.`);
if (report.length) console.log(`\nNeeds review (${report.length}):\n` + report.map((r) => `  - ${r}`).join("\n"));
