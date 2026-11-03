// The one door to the practice data. Pages call these functions and never read the
// data files themselves, so moving the data into a database later changes this file only.
//
// Today the data is bundled with the site, so these functions answer straight away.
// When a server and database arrive, levels and topics (small, needed for every page
// address) can be loaded once at start-up and stay like this; questions move behind an
// API call (see data/README.md).

import levelsData from "./data/levels.json" with { type: "json" };
import topicsData from "./data/topics.json" with { type: "json" };
import sourcesData from "./data/sources.json" with { type: "json" };
import placementsData from "./data/mcq/placements.json" with { type: "json" };
import variablesMcqs from "./data/mcq/questions/variables.json" with { type: "json" };
import outputMcqs from "./data/mcq/questions/output.json" with { type: "json" };
import inputMcqs from "./data/mcq/questions/input.json" with { type: "json" };
import arithmeticMcqs from "./data/mcq/questions/arithmetic.json" with { type: "json" };
import type { Level, McqPlacement, McqQuestion, Source, Topic } from "./types.ts";

export type { Level, McqOption, McqPlacement, McqQuestion, Source, Topic } from "./types.ts";

// Every file in data/mcq/questions/ must be listed here (the bank test checks this).
export const MCQ_QUESTION_FILES = { variables: variablesMcqs, output: outputMcqs, input: inputMcqs, arithmetic: arithmeticMcqs };

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

const levels = (levelsData as Level[]).slice().sort(byOrder);
const topics = (topicsData as Topic[]).slice().sort(byOrder);
const sources = sourcesData as Source[];
const placements = (placementsData as McqPlacement[]).slice().sort(byOrder);
const mcqs = new Map<string, McqQuestion>(
  Object.values(MCQ_QUESTION_FILES).flatMap((file) => (file as McqQuestion[]).map((q) => [q.id, q] as const)),
);

// ---- Levels and topics ----------------------------------------------------------

export function getLevels(): Level[] {
  return levels;
}

export function getLevel(levelId: string): Level | null {
  return levels.find((l) => l.id === levelId) ?? null;
}

/** A level's topics in teaching order. */
export function getTopics(levelId: string): Topic[] {
  return topics.filter((t) => t.levelId === levelId);
}

export interface TopicEntry {
  level: Level;
  topic: Topic;
  number: number; // 1-based position in the level
  total: number;
  previous: Topic | null;
  next: Topic | null;
}

/** A topic found by its address (#/practice/<levelId>/<slug>), with its neighbours. */
export function getTopic(levelId: string, slug: string): TopicEntry | null {
  const level = getLevel(levelId);
  if (!level) return null;
  const list = getTopics(levelId);
  const index = list.findIndex((t) => t.slug === slug);
  if (index === -1) return null;
  return {
    level,
    topic: list[index],
    number: index + 1,
    total: list.length,
    previous: list[index - 1] ?? null,
    next: list[index + 1] ?? null,
  };
}

// ---- Multiple-choice questions ---------------------------------------------------

/** A topic's multiple-choice questions, in the order they're placed there. */
export function getMcqs(topicId: string): McqQuestion[] {
  return placements
    .filter((p) => p.topicId === topicId)
    .map((p) => mcqs.get(p.questionId))
    .filter((q): q is McqQuestion => q !== undefined);
}

export function countMcqs(topicId: string): number {
  return placements.filter((p) => p.topicId === topicId && mcqs.has(p.questionId)).length;
}

export function getMcq(questionId: string): McqQuestion | null {
  return mcqs.get(questionId) ?? null;
}

export function getSource(sourceId: string): Source | null {
  return sources.find((s) => s.id === sourceId) ?? null;
}
