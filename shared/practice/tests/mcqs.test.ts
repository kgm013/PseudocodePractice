// Checks every multiple-choice question file, so a broken question can't reach the site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../data/mcqs/", import.meta.url);
const ID = /^(ol|as)-[a-z0-9-]+-mcq-\d{3}$/;

const files = readdirSync(root).flatMap((level) =>
  readdirSync(new URL(`${level}/`, root)).map((name) => ({ level, topic: name.replace(/\.json$/, ""), url: new URL(`${level}/${name}`, root) })),
);

test("there are question files for both levels", () => {
  assert.deepEqual([...new Set(files.map((f) => f.level))].sort(), ["as", "ol"]);
});

test("question IDs are unique across all files", () => {
  const seen = new Set<string>();
  for (const f of files) {
    for (const q of JSON.parse(readFileSync(f.url, "utf8"))) {
      assert.ok(!seen.has(q.id), `duplicate id ${q.id}`);
      seen.add(q.id);
    }
  }
});

for (const f of files) {
  test(`${f.level}/${f.topic}.json is well formed`, () => {
    const questions = JSON.parse(readFileSync(f.url, "utf8"));
    assert.ok(Array.isArray(questions), "file must hold an array");
    const orders = new Set<number>();
    for (const q of questions) {
      assert.match(q.id, ID, `bad id ${q.id}`);
      assert.ok(q.id.startsWith(`${f.level}-${f.topic}-mcq-`), `${q.id} is in the wrong file`);
      assert.ok(Number.isInteger(q.order) && !orders.has(q.order), `${q.id}: order must be a unique whole number`);
      orders.add(q.order);
      assert.ok(typeof q.prompt === "string" && q.prompt.trim(), `${q.id}: missing prompt`);
      assert.ok(typeof q.explanation === "string" && q.explanation.trim(), `${q.id}: missing explanation`);
      assert.ok(q.code === undefined || typeof q.code === "string", `${q.id}: code must be text`);
      assert.ok(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6, `${q.id}: needs 2 to 6 options`);
      const optionIds = q.options.map((o: { id: string }) => o.id);
      assert.equal(new Set(optionIds).size, optionIds.length, `${q.id}: option ids must be unique`);
      for (const o of q.options) assert.ok(typeof o.text === "string" && o.text.trim(), `${q.id}: empty option`);
      assert.ok(optionIds.includes(q.answer), `${q.id}: answer "${q.answer}" isn't one of the options`);
    }
  });
}
