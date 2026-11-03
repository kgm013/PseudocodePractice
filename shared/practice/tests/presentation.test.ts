import test from "node:test";
import assert from "node:assert/strict";
import { matchesFilters, progressInfo, toggleFilter } from "../presentation.ts";

test("written progress counts solved questions, excluding incorrect and skipped", () => {
  assert.deepEqual(progressInfo({ correct: 2, checked: 3, progressKind: "solved" }), { value: 2, label: "solved", written: true });
  assert.equal(progressInfo({ correct: 0, checked: 4, progressKind: "solved" }).value, 0);
});

test("MCQ progress counts checked answers, including incorrect answers", () => {
  assert.deepEqual(progressInfo({ correct: 2, checked: 3 }), { value: 3, label: "answered", written: false });
});

test("incorrect and skipped filters show either group without solved questions", () => {
  for (const written of [true, false]) {
    const filters = ["wrong", "skipped"];
    assert.equal(matchesFilters("wrong", false, filters, written), true);
    assert.equal(matchesFilters("skipped", false, filters, written), true);
    assert.equal(matchesFilters("correct", false, filters, written), false);
    assert.equal(matchesFilters("unanswered", false, filters, written), false);
    assert.equal(matchesFilters("answered", false, filters, written), false);
  }
});

test("toggling filters preserves the other groups; clearing shows everything", () => {
  assert.deepEqual(toggleFilter(["wrong"], "skipped"), ["wrong", "skipped"]);
  assert.deepEqual(toggleFilter(["wrong", "skipped"], "wrong"), ["skipped"]);
  assert.deepEqual(toggleFilter(["skipped"], "skipped"), []);
  for (const status of ["correct", "wrong", "skipped", "unanswered", "answered"]) {
    assert.equal(matchesFilters(status, false, []), true);
  }
});

test("not-solved includes skipped written questions; unanswered MCQs do not", () => {
  assert.equal(matchesFilters("skipped", false, ["todo"], true), true);
  assert.equal(matchesFilters("skipped", false, ["todo"]), false);
  assert.equal(matchesFilters("correct", false, ["todo"], true), false);
  assert.equal(matchesFilters("correct", true, ["wrong", "flagged"]), true);
  assert.equal(matchesFilters("correct", false, ["wrong", "flagged"]), false);
});
