// The shapes of the practice data in shared/practice/data/.
// Each type is one future database table; field names are camelCase here and
// snake_case in the database (see data/README.md for the mapping and the SQL).

/** A syllabus group. Table: levels. */
export interface Level {
  id: "ol" | "as"; // used in page addresses: #/practice/ol
  name: string; // "O Level / IGCSE"
  codes: string; // "2210 · 0478"
  interpreterLevel: "O" | "AS"; // what compile() expects
  order: number;
}

/** A topic within one level. Table: topics. */
export interface Topic {
  id: string; // "ol-variables": permanent, never reused
  levelId: Level["id"];
  slug: string; // "variables": the address part, #/practice/ol/variables
  title: string;
  summary: string; // backticks mark code
  order: number; // position within the level
}

/** Where questions came from, so a re-import updates instead of duplicating. Table: sources. */
export interface Source {
  id: string; // "four-lessons"
  title: string;
  kind: "worksheet" | "past-paper" | "original";
}

/** One answer option. Table: mcq_options (question_id, id, sort_order, text). */
export interface McqOption {
  id: string; // "a".."f", unique within the question
  text: string; // backticks mark code; spaces inside code are significant
}

export type McqResultKind = "output" | "valid" | "invalid" | "value";
export type ReviewStatus = "ok" | "needs-review";

/**
 * A multiple-choice question, stored once and shown in any number of topics
 * through placements. Table: mcq_questions (options go to mcq_options).
 */
export interface McqQuestion {
  id: string; // "mcq-input-001": permanent, never reused, not tied to a level
  version: number; // bump when the meaning of the question changes
  sourceId: Source["id"];
  sourceRef: string; // the question's number in its source, e.g. "Q59"
  prompt: string; // backticks mark code
  code?: string; // pseudocode shown with the question
  inputs?: string[]; // values the user types, in order (from "The user enters ...")
  options: McqOption[]; // in display order
  answer: McqOption["id"];
  resultKind: McqResultKind; // what the correct answer is: an output, valid / invalid, or a value
  resultText: string; // e.g. "ID:004", "Invalid pseudocode", "INTEGER"
  explanation: string;
  reviewStatus: ReviewStatus; // "needs-review" when the interpreter disagrees with the answer key
  reviewNote?: string;
}

/** Shows a question in a topic. Table: topic_mcqs (topic_id, question_id) is the key. */
export interface McqPlacement {
  topicId: Topic["id"];
  questionId: McqQuestion["id"];
  order: number; // position within the topic
}
