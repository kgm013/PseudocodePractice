# Practice data

The question bank and the structure of the practice pages. There is no database yet:
these files are bundled with the site. Each file is shaped like a database table, so moving
to PostgreSQL later is a one-off import, not a rewrite.

Only `shared/practice/bank.ts` reads these files. Pages go through `bank.ts`, so when the
data moves into a database only that file changes.

## Files

| File | Table | One row per |
|---|---|---|
| `levels.json` | `levels` | syllabus group (`ol`, `as`) |
| `topics.json` | `topics` | topic within a level (`ol-variables`, `as-variables`, ...) |
| `sources.json` | `sources` | worksheet or paper the questions came from |
| `mcq/questions/<lesson>.json` | `mcq_questions` + `mcq_options` | multiple-choice question; its `options` list becomes rows in `mcq_options` |
| `mcq/placements.json` | `topic_mcqs` | question shown in a topic, with its position |
| `known-ids.txt` | (none) | every ID ever used, so none is reused or lost |

### Questions are stored once, placed many times

A question isn't tied to a level. `mcq/placements.json` links each question to the topics it
appears in, in order. The same question can appear at O Level / IGCSE and AS without being
copied, and can be removed from one level by deleting its placement row. Question files are
grouped by the lesson they came from only to keep them readable; placements decide where
questions appear.

### Fields

Names are camelCase here and snake_case in the database (`sourceRef` → `source_ref`).
Optional fields are left out when empty; never write `null`.

**Question** (`mcq_questions`)

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Permanent ID, `mcq-<lesson>-001`. Never renamed or reused. |
| `version` | yes | Starts at 1. The import script bumps it when the prompt, code, options or answer change. |
| `sourceId`, `sourceRef` | yes | Where it came from (`four-lessons`, `Q59`). A re-import matches on these and updates in place. |
| `prompt` | yes | The question. Backticks mark code. |
| `code` | no | Pseudocode shown with the question (`←` for assignment). |
| `inputs` | no | Values the user types, in order. Used to check the question with the interpreter. |
| `options` | yes | 2 to 6 options, in display order: `{ id: "a", text }`. Backticks mark code; spaces inside code count. |
| `answer` | yes | The correct option's `id`. |
| `resultKind` | yes | `output` (what's displayed), `valid`, `invalid`, or `value` (e.g. a data type). |
| `resultText` | yes | The answer key's result: `ID:004`, `Invalid pseudocode`, `INTEGER`. |
| `explanation` | yes | Shown after the student checks their answer. |
| `reviewStatus` | yes | `ok`, or `needs-review` when the interpreter disagrees with the answer key. |
| `reviewNote` | with needs-review | Why it needs review. |

## Adding questions

Questions in the LaTeX worksheet format (a questions file and a solutions file per lesson):

```
npm run import:mcqs -- <questions-folder> <solutions-folder> --source <id> --title "<title>"
```

- Files are paired by name: `pseudocode_03_input_questions.tex` + `pseudocode_03_input_solutions.tex`.
  The middle part (`input`) must match a topic slug in `topics.json`.
- Running it again updates questions in place: IDs stay the same and nothing is duplicated.
- New questions are placed in that topic at every level. Existing placements are kept, so a
  question you removed from a level stays removed.
- Every question's code is run through the interpreter at each level it's placed at, and
  compared with the answer key. Disagreements are marked `needs-review` and listed at the end.

Then run `npm test`. The tests check every rule a database would: unique IDs, links that
resolve, required fields, orders, that no ID from `known-ids.txt` has disappeared, and that
questions marked `ok` still agree with the interpreter.

## Future database tables

A starting point for PostgreSQL, to adjust to the wider project's conventions.

```sql
CREATE TABLE levels (
  id                text PRIMARY KEY,                 -- 'ol', 'as'
  name              text NOT NULL,
  codes             text NOT NULL,
  interpreter_level text NOT NULL CHECK (interpreter_level IN ('O', 'AS')),
  sort_order        integer NOT NULL UNIQUE
);

CREATE TABLE topics (
  id         text PRIMARY KEY,                        -- 'ol-variables'
  level_id   text NOT NULL REFERENCES levels(id),
  slug       text NOT NULL,
  title      text NOT NULL,
  summary    text NOT NULL,
  sort_order integer NOT NULL,
  UNIQUE (level_id, slug),
  UNIQUE (level_id, sort_order)
);

CREATE TABLE sources (
  id    text PRIMARY KEY,                             -- 'four-lessons'
  title text NOT NULL,
  kind  text NOT NULL CHECK (kind IN ('worksheet', 'past-paper', 'original'))
);

CREATE TABLE mcq_questions (
  id            text PRIMARY KEY,                     -- 'mcq-input-001'
  version       integer NOT NULL DEFAULT 1,
  source_id     text NOT NULL REFERENCES sources(id),
  source_ref    text NOT NULL,                        -- 'Q59'
  prompt        text NOT NULL,
  code          text,
  inputs        text[] NOT NULL DEFAULT '{}',
  answer        text NOT NULL,                        -- an mcq_options.id of this question
  result_kind   text NOT NULL CHECK (result_kind IN ('output', 'valid', 'invalid', 'value')),
  result_text   text NOT NULL,
  explanation   text NOT NULL,
  review_status text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok', 'needs-review')),
  review_note   text,
  retired_at    timestamptz,                          -- retired, never deleted
  UNIQUE (source_id, source_ref)
);

CREATE TABLE mcq_options (
  question_id text NOT NULL REFERENCES mcq_questions(id),
  id          text NOT NULL,                          -- 'a'
  sort_order  integer NOT NULL,
  text        text NOT NULL,
  PRIMARY KEY (question_id, id),
  UNIQUE (question_id, sort_order)
);

CREATE TABLE topic_mcqs (
  topic_id    text NOT NULL REFERENCES topics(id),
  question_id text NOT NULL REFERENCES mcq_questions(id),
  sort_order  integer NOT NULL,
  PRIMARY KEY (topic_id, question_id),
  UNIQUE (topic_id, sort_order)
);
```

`order` becomes `sort_order` because `ORDER` is a reserved word in SQL. Anything that writes
student data uses parameterised queries, never SQL built from student input.

When the server arrives: load levels and topics once at start-up (they're small and every page
address needs them), fetch a topic's questions through an API call, and mark answers on the
server so the answer key doesn't have to be sent to the browser.
