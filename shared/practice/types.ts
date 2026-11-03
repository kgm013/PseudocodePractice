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

/** One run of a written answer. Table: written_tests (question_id, id). */
export interface WrittenTest {
  id: string; // "t1", unique within the question
  inputs?: string[]; // values for INPUT, in order
  files?: Record<string, string>; // text files that exist before the program runs
  expected?: string[]; // only when the model solution's output shouldn't be used
  hidden?: boolean; // never shown, not even after "Reveal output"
}

/**
 * A question answered by writing pseudocode, stored once and placed in topics like
 * multiple choice. Table: written_questions (tests go to written_tests).
 * `solution` and hidden tests never reach the page: bank.ts strips them.
 */
export interface WrittenQuestion {
  id: string; // "wq-input-001": permanent, never reused
  version: number;
  sourceId: Source["id"];
  sourceRef: string;
  title: string;
  prompt: string; // backticks mark code; a blank line starts a new paragraph
  starterCode?: string;
  solution: string; // model answer; its output is what answers are compared with
  harness?: string; // code added after the student's (e.g. calls to their FUNCTION)
  exactOutput?: boolean; // true = no extra lines (such as input prompts) allowed
  mustUse?: string[]; // constructs the answer must contain, e.g. ["FOR"]
  mustNotUse?: string[];
  hints?: string[];
  difficulty?: 1 | 2 | 3;
  tests: WrittenTest[];
  reviewStatus: ReviewStatus;
  reviewNote?: string;
}

/** What a page may see of a written question: no solution, no hidden tests. */
export type WrittenQuestionForPage = Omit<WrittenQuestion, "solution" | "harness" | "tests"> & {
  tests: Pick<WrittenTest, "id" | "inputs" | "files">[]; // visible tests only
};

/** Table: topic_written (topic_id, question_id) is the key. */
export interface WrittenPlacement {
  topicId: Topic["id"];
  questionId: WrittenQuestion["id"];
  order: number;
}
