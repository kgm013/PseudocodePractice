// Keeps the practice data valid, and enforces the same rules a database would
// (unique keys, links that resolve, required fields), so the files can be imported
// into PostgreSQL later without errors. See shared/practice/data/README.md.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MCQ_QUESTION_FILES, countMcqs, getLevels, getMcqs, getTopic, getTopics } from "../bank.ts";
import { verifyMcq } from "../verifyMcq.ts";
import type { Level, McqPlacement, McqQuestion, Source, Topic } from "../types.ts";

const data = new URL("../data/", import.meta.url);
const read = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, data), "utf8"));

const levels = read<Level[]>("levels.json");
const topics = read<Topic[]>("topics.json");
const sources = read<Source[]>("sources.json");
const placements = read<McqPlacement[]>("mcq/placements.json");
const questionFiles = readdirSync(new URL("mcq/questions/", data)).filter((f) => f.endsWith(".json"));
const questions = questionFiles.flatMap((f) => read<McqQuestion[]>(`mcq/questions/${f}`).map((q) => ({ ...q, file: f })));

const knownText = readFileSync(new URL("known-ids.txt", data), "utf8");
const [activeText, retiredText = ""] = knownText.split(/^# Retired$/m);
const idsIn = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const activeIds = idsIn(activeText);
const retiredIds = idsIn(retiredText);

const unique = (values: string[], what: string) => {
  const seen = new Set<string>();
  for (const v of values) {
    assert.ok(!seen.has(v), `duplicate ${what}: ${v}`);
    seen.add(v);
  }
};
const noNulls = (row: object, what: string) => {
  for (const [k, v] of Object.entries(row)) assert.notEqual(v, null, `${what}: leave out empty fields instead of null (${k})`);
};

describe("levels and topics", () => {
  test("levels have unique ids and orders", () => {
    unique(levels.map((l) => l.id), "level id");
    unique(levels.map((l) => String(l.order)), "level order");
    for (const l of levels) {
      noNulls(l, l.id);
      assert.ok(["O", "AS"].includes(l.interpreterLevel), `${l.id}: interpreterLevel must be O or AS`);
    }
  });

  test("topics link to a level and are unique within it", () => {
    unique(topics.map((t) => t.id), "topic id");
    for (const level of levels) {
      const mine = topics.filter((t) => t.levelId === level.id);
      unique(mine.map((t) => t.slug), `slug in ${level.id}`);
      unique(mine.map((t) => String(t.order)), `order in ${level.id}`);
    }
    for (const t of topics) {
      noNulls(t, t.id);
      assert.ok(levels.some((l) => l.id === t.levelId), `${t.id}: unknown level ${t.levelId}`);
      assert.equal(t.id, `${t.levelId}-${t.slug}`, `${t.id}: topic ids are <level>-<slug>`);
      assert.match(t.slug, /^[a-z0-9-]+$/, `${t.id}: slugs use lower-case letters, digits and hyphens`);
    }
  });
});

describe("multiple-choice questions", () => {
  test("every question file is loaded by bank.ts", () => {
    const loaded = Object.keys(MCQ_QUESTION_FILES).map((name) => `${name}.json`).sort();
    assert.deepEqual(loaded, [...questionFiles].sort(), "add the new file to MCQ_QUESTION_FILES in bank.ts");
  });

  test("question ids are unique and permanent-looking", () => {
    unique(questions.map((q) => q.id), "question id");
    unique(questions.map((q) => `${q.sourceId}:${q.sourceRef}`), "source + question number");
    for (const q of questions) {
      const slug = q.file.replace(/\.json$/, "");
      assert.match(q.id, new RegExp(`^mcq-${slug}-\\d{3}$`), `${q.id}: ids in ${q.file} are mcq-${slug}-<3 digits>`);
    }
  });

  test("questions are complete", () => {
    for (const q of questions) {
      const { file, ...row } = q;
      noNulls(row, q.id);
      assert.ok(Number.isInteger(q.version) && q.version >= 1, `${q.id}: version must be 1 or more`);
      assert.ok(sources.some((s) => s.id === q.sourceId), `${q.id}: unknown source ${q.sourceId}`);
      assert.ok(q.prompt.trim(), `${q.id}: missing prompt`);
      assert.ok(q.explanation.trim(), `${q.id}: missing explanation`);
      assert.ok(q.code === undefined || q.code.trim(), `${q.id}: empty code`);
      assert.ok(q.inputs === undefined || (Array.isArray(q.inputs) && q.inputs.length > 0), `${q.id}: inputs must be a non-empty list`);
      assert.ok(q.options.length >= 2 && q.options.length <= 6, `${q.id}: needs 2 to 6 options`);
      unique(q.options.map((o) => o.id), `option id in ${q.id}`);
      for (const o of q.options) assert.ok(o.text.trim(), `${q.id}: empty option ${o.id}`);
      assert.ok(q.options.some((o) => o.id === q.answer), `${q.id}: answer ${q.answer} isn't an option`);
      assert.ok(["output", "valid", "invalid", "value"].includes(q.resultKind), `${q.id}: bad resultKind`);
      assert.ok(q.resultText.trim(), `${q.id}: missing resultText`);
      assert.ok(["ok", "needs-review"].includes(q.reviewStatus), `${q.id}: bad reviewStatus`);
      assert.equal(q.reviewStatus === "needs-review", Boolean(q.reviewNote), `${q.id}: a reviewNote goes with needs-review only`);
    }
  });

  test("placements link real topics and questions", () => {
    unique(placements.map((p) => `${p.topicId}:${p.questionId}`), "placement");
    for (const p of placements) {
      assert.ok(topics.some((t) => t.id === p.topicId), `placement: unknown topic ${p.topicId}`);
      assert.ok(questions.some((q) => q.id === p.questionId), `placement: unknown question ${p.questionId}`);
    }
    for (const t of topics) unique(placements.filter((p) => p.topicId === t.id).map((p) => String(p.order)), `order in ${t.id}`);
    for (const q of questions) assert.ok(placements.some((p) => p.questionId === q.id), `${q.id} isn't placed in any topic`);
  });

  test("questions marked ok still agree with the interpreter", () => {
    for (const q of questions.filter((x) => x.reviewStatus === "ok")) {
      const placedLevels = new Set(
        placements
          .filter((p) => p.questionId === q.id)
          .map((p) => levels.find((l) => l.id === topics.find((t) => t.id === p.topicId)!.levelId)!.interpreterLevel),
      );
      for (const level of placedLevels) {
        const v = verifyMcq(q, level);
        assert.notEqual(v.status, "mismatch", `${q.id} (${q.sourceRef}) at ${level}: ${v.note}`);
      }
    }
  });
});

describe("permanent ids", () => {
  const current = [...levels.map((l) => l.id), ...topics.map((t) => t.id), ...sources.map((s) => s.id), ...questions.map((q) => q.id)];

  test("every id in use is listed in known-ids.txt", () => {
    for (const id of current) assert.ok(activeIds.includes(id), `${id} is missing from known-ids.txt`);
  });

  test("no listed id has disappeared (retire it on purpose instead)", () => {
    for (const id of activeIds) assert.ok(current.includes(id), `${id} is in known-ids.txt but no longer in the data. Move it under "# Retired" if that's intended.`);
    for (const id of retiredIds) assert.ok(!current.includes(id), `${id} is retired and can't be used again`);
  });
});

describe("bank.ts", () => {
  test("returns levels, topics and questions in order", () => {
    assert.deepEqual(getLevels().map((l) => l.id), ["ol", "as"]);
    assert.deepEqual(getTopics("ol").map((t) => t.slug), ["variables", "output", "input", "arithmetic"]);
    const entry = getTopic("as", "input");
    assert.equal(entry?.topic.id, "as-input");
    assert.equal(entry?.previous?.slug, "output");
    assert.equal(getTopic("ol", "nope"), null);
    const inOrder = getMcqs("ol-input").map((q) => q.id);
    const expected = placements.filter((p) => p.topicId === "ol-input").sort((a, b) => a.order - b.order).map((p) => p.questionId);
    assert.deepEqual(inOrder, expected);
    assert.equal(countMcqs("ol-input"), expected.length);
  });
});
