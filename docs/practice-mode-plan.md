# Practice mode: implementation plan (MVP)

Ordered steps for adding O Level and AS Level practice modules to Pseudocode Practice.
Do the steps in order; each one should leave the site working and deployable.

## Context

- React 18 + Vite client in `client/`, deployed to GitHub Pages (`base: /PseudocodePractice/`) by
  `.github/workflows/deploy.yml` on every push to `main`.
- The interpreter is in `shared/interpreter/` (TypeScript, imported in the client as `@shared/...`).
  `compile(source, level)` returns `{ program, diagnostics }`; `runSource(source, { inputs, files, level, random })`
  runs a program with fixed INPUT values and returns `{ diagnostics, output, error, files, runtimeWarnings, steps, ran }`.
  The AST types are in `shared/interpreter/ast.ts` (statements have a `k` field such as `"if"`, `"for"`, `"case"`).
- The existing page (the "compiler") is `App.jsx` → `Playground`. It stays, unchanged in behaviour, as its own page.
- `server/` is an Express stub. It is **not** used by this MVP.
- Tests: `npm test` at the repo root (`node --test "shared/interpreter/tests/*.test.ts"`).

## Decisions already made

- **No database and no accounts.** The question bank lives in files in the repo; progress is kept in the browser
  (localStorage). Code must be structured so a server/PostgreSQL can replace both later (see step 9).
- **Students never see their program's output when checking.** They only see whether the answer is correct.
  A "Reveal output" button exists (see open decisions).
- **Marking rules:**
  - The expected lines must appear in the student's output **in order**; extra lines are allowed
    (so input prompts like `OUTPUT "Enter a number"` don't fail).
  - Whitespace differences are ignored: trim each line and collapse runs of spaces/tabs to one space.
  - Upper/lower case differences count as wrong. `5` vs `5.0` counts as wrong (compare text, not numbers).
  - A question can set `exactOutput: true`: then the normalised output must equal the expected lines exactly
    (stops "print every possible answer" from passing).
- Test cases are written per question when the bank is created.

## Open decisions (ask the user; build with the defaults behind one config constant)

1. Feedback on a wrong answer: just "Not yet", or "Passed 2 of 4 tests". Default: "Passed X of Y tests".
2. What "Reveal output" shows (student's own output / expected output / model solution) and whether it is always
   available or unlocks after N wrong attempts. Default: student's own output, always available.
3. Can students open any question, or must earlier ones be solved first? Default: all open.
4. Final topic list for each level (the user is providing the question bank). Use the provisional lists in step 2.

## Conventions

- No `eval` / `new Function`; never render question text or student code/output with `dangerouslySetInnerHTML`
  (render as text, `white-space: pre-wrap`).
- Wrap every localStorage/sessionStorage access in try/catch; the page must work if storage is blocked.
- Commit messages must **not** include `Co-Authored-By: Claude` or "Generated with Claude" lines.
- Keep the existing compiler's storage keys (`pseudo-practice:olevel:code`, etc.) so students don't lose code.

---

## Step 1: Routing, landing page, compiler page

1. Add hash-based routing (GitHub Pages has no SPA fallback, so `/practice/ol` would 404 on refresh).
   Either `react-router-dom` with `HashRouter`, or a small `useHashRoute()` hook that parses `location.hash`
   and listens to `hashchange`. Routes:
   - `#/` → landing page
   - `#/compiler` → existing playground
   - `#/practice/:level` → topic list (`level` is `ol` or `as`)
   - `#/practice/:level/:topicId` → question list
   - `#/practice/:level/:topicId/:questionId` → question page
   - anything else → landing page
2. Move `Playground` and `LevelSwitch` out of `App.jsx` into `client/src/pages/CompilerPage.jsx`.
   `App.jsx` keeps the header and theme toggle (shared by all pages) and renders the page for the current route.
   The O/AS level switch only shows on the compiler page.
3. `client/src/pages/LandingPage.jsx`: three links: O Level Practice (`#/practice/ol`),
   AS Level Practice (`#/practice/as`), Compiler (`#/compiler`).
4. Set `document.title` per page. Make the site title in the header link to `#/`.
5. Check: `npm run build --prefix client`, then the existing compiler works exactly as before at `#/compiler`,
   and refreshing on any route works.

## Step 2: Question bank format and sample questions

1. Create `shared/practice/` (shared so the server can import the same data later).
2. `shared/practice/types.ts`:
   ```ts
   type LevelId = "O" | "AS";
   interface Topic { id: string; level: LevelId; title: string; order: number }
   interface TestCase {
     id: string;                       // unique within the question, e.g. "t1"
     inputs?: string[];                // INPUT values, in order
     files?: Record<string, string>;   // starting text files
     expected?: string[];              // optional override; normally computed from the solution
     checkFiles?: string[];            // also compare these files written by the program
   }
   interface Question {
     id: string;                       // permanent, e.g. "ol-selection-03"; never reuse or rename
     level: LevelId;
     topic: string;                    // Topic.id
     order: number;
     type: "write-code";               // leaves room for trace tables, predict-the-output, etc.
     title: string;
     prompt: string;                   // plain text
     starterCode?: string;
     solution: string;                 // model answer; also used to compute expected output
     tests: TestCase[];
     harness?: string;                 // code appended after the student's code (e.g. calls to their FUNCTION)
     exactOutput?: boolean;
     mustUse?: string[];               // e.g. ["FOR"], ["CASE"], ["CONSTANT"]
     mustNotUse?: string[];
     hints?: string[];
   }
   ```
3. Files: `shared/practice/topics.json` (all topics, both levels) and one file per topic:
   `shared/practice/questions/ol/<topic-id>.json`, `shared/practice/questions/as/<topic-id>.json`
   (each an array of `Question`). Keep the JSON flat so it maps directly to PostgreSQL tables later
   (topics, questions, test_cases).
4. Provisional topic ids (confirm with the user):
   - O Level 2210: `variables-constants`, `output`, `input`, `arithmetic`, `selection`, `iteration`,
     `totalling-counting`, `string-handling`, `arrays`, `procedures-functions`, `library-routines`,
     `file-handling`, `standard-algorithms`.
   - AS 9618: the same, plus `records`; AS file handling includes `EOF` and `APPEND`.
5. Add 2–3 sample questions to two or three O Level topics so the UI can be built before the real bank arrives.
6. `shared/practice/bank.ts`: typed loaders `getTopics(level)`, `getQuestions(level, topicId)`,
   `getQuestion(id)`. In the client, load the JSON with `import.meta.glob(..., { eager: true })` or
   static imports.

## Step 3: The answer checker (pure, shared)

`shared/practice/checker.ts`, no DOM or React. It must run in Node (tests), in a Web Worker and later on the server.

1. `checkAnswer(question, studentCode): CheckResult` where
   ```ts
   interface TestResult {
     id: string; passed: boolean;
     reason?: "wrong-output" | "runtime-error" | "too-few-inputs" | "files-differ";
     errorMessage?: string;              // runtime error text (no output)
     studentOutput: string[];            // kept for "Reveal output"; not shown by default
   }
   interface CheckResult {
     status: "correct" | "wrong" | "compile-error" | "rule-failed";
     diagnostics: Diagnostic[];          // compile errors/warnings
     ruleFailures: string[];             // e.g. "Use a FOR loop for this question."
     tests: TestResult[]; passed: number; total: number;
   }
   ```
2. Order of checks:
   1. `compile(studentCode, level)`. If it has errors → `compile-error` (return diagnostics only).
   2. Structural rules: walk `program.body` recursively (into IF/ELSE, CASE clauses, loop bodies, procedure and
      function bodies) and collect what is used. Map rule names to nodes: `IF`→`k:"if"`, `CASE`→`"case"`,
      `FOR`/`WHILE`/`REPEAT`→loop kinds, `PROCEDURE`/`FUNCTION`→definitions, `CONSTANT`→`"constant"`,
      `ARRAY`→declarations whose type is an array, `OPENFILE`/`READFILE`/`WRITEFILE`, and built-in names
      (`MOD`, `DIV`, `ROUND`, `RANDOM`, `LENGTH`, `SUBSTRING`, ...) from expressions. A missing `mustUse` or a
      present `mustNotUse` → `rule-failed`.
   3. For each test: run the solution (plus `harness`) and the student's code (plus `harness`) with
      `runSource(code, { inputs, files, level, random })`. Use a fixed seeded `random` so RANDOM is repeatable.
      Expected lines = `test.expected` if given, else the solution's output.
      - Student runtime error → failed (`runtime-error`, keep message).
      - "asked for more INPUT values than were given" → failed (`too-few-inputs`).
      - Compare with the marking rules (normalise, then in-order subsequence; or exact when `exactOutput`).
      - `checkFiles`: compare those files the same way.
   4. `correct` only when every test passes.
3. Check that appending `harness` code after student code works at both levels (where procedures/functions may be
   defined relative to the main program). If it doesn't, adjust how harness code is combined, and document it.
4. Unit tests in `shared/practice/tests/checker.test.ts`: prompts before input still pass; wrong order fails;
   case difference fails; `5` vs `5.0` fails; extra spaces pass; `exactOutput` rejects extra lines;
   endless loop fails with the step-limit error; missing INPUT values; `mustUse`/`mustNotUse`;
   harness calling a student FUNCTION; file output checks.
5. Update the root `test` script to also run `shared/practice/tests/*.test.ts`.

## Step 4: Bank validation tests and CI

1. `shared/practice/tests/bank.test.ts`, run over every question file:
   - ids unique across the whole bank; topic ids exist in `topics.json`; levels match the folder.
   - the solution compiles with no errors (and no warnings) at its level.
   - `checkAnswer(question, question.solution)` is `correct` (catches broken tests and broken rules).
   - every test has a unique id; questions with INPUT in the solution have at least 2 tests.
2. Edit `.github/workflows/deploy.yml`: before the client build, `npm ci` (or `npm install`) at the root,
   then `npm test` and `npm run typecheck`, so a broken question bank can't deploy.
   Node 22 in CI must run `.ts` tests without flags (type stripping is on by default from 22.18); verify, and
   bump the CI Node version if needed.

## Step 5: Run checks in a Web Worker

1. `client/src/practice/check.worker.js`: on `{ type: "check", question, code }` call `checkAnswer` and post
   `{ type: "result", result }`. Same worker setup as `client/src/interpreter/pseudo.worker.js`.
2. `client/src/practice/useAnswerChecker.js`: starts the worker, exposes `check(question, code)`,
   `status` (`idle | checking | done`) and `result`. Terminate and recreate the worker on a new check, on unmount,
   and after a timeout (e.g. 10 s) with a "your program took too long" result.

## Step 6: Progress storage (the data-access layer)

All reads/writes of progress go through `client/src/practice/progressStore.js`; pages never touch localStorage.
This is the file that later switches to API calls.

1. One localStorage key, `pseudo-practice:progress:v1`:
   ```json
   { "version": 1,
     "questions": { "ol-selection-03": { "status": "solved", "attempts": 3, "lastCode": "...",
                                         "solvedAt": "2026-11-02T10:00:00Z", "revealed": false } } }
   ```
   `status` is `"attempted"` or `"solved"` (absent = not started). Once solved, stays solved.
2. API: `getProgress()`, `getQuestionProgress(id)`, `saveCode(id, code)` (debounced ~400 ms),
   `recordAttempt(id, correct)`, `markRevealed(id)`, `topicSummary(level, topicId)` → `{ solved, total }`,
   `resetProgress()`, `exportProgress()` → downloads `pseudocode-progress.json`,
   `importProgress(file)`.
3. Import must treat the file as untrusted: size limit (e.g. 2 MB), JSON parse in try/catch, check `version`,
   keep only known question ids, check field types, cap `lastCode` length; then merge (solved wins,
   attempts = max).
4. A React hook (`useProgress`) re-renders pages when progress changes (and on the `storage` event,
   so two open tabs stay in sync).

## Step 7: Practice pages

Reuse `CodeEditor` (props: `level`, `initialValue`, `onChange`, `onDiagnostics`, `onRun`) and `ProblemsList`.

1. `pages/PracticeLevelPage.jsx` (`#/practice/:level`): topics in order, each with solved/total from
   `topicSummary`. Export / Import / Reset progress buttons here (Reset asks for confirmation).
2. `pages/TopicPage.jsx` (`#/practice/:level/:topicId`): questions in order with status (not started / attempted /
   solved).
3. `pages/QuestionPage.jsx` (`#/practice/:level/:topicId/:questionId`):
   - Question title and prompt (plain text), hints (revealed one at a time).
   - Editor loads `lastCode`, else `starterCode`, else empty; `onChange` → `saveCode`.
   - Live compile diagnostics in the Problems list, as on the compiler page.
   - "Check answer" (and Ctrl+Enter, via `onRun`) → `useAnswerChecker` → `recordAttempt`. Show:
     compile errors (Problems list), rule failures, runtime error messages, then Correct / Not yet
     (per open decision 1). Never show program output here.
   - "Reveal output" → shows `studentOutput` per test (per open decision 2) and calls `markRevealed`.
   - Previous / next question links; back link to the topic.
   - Unknown level/topic/question id → "not found" message with a link back.
4. Empty states: a topic with no questions yet shows "Questions coming soon".

## Step 8: AS Level and the real question bank

1. AS uses the same pages; only topics and question files differ (`level: "AS"` runs the AS interpreter rules).
2. When the user sends the bank, write a one-off conversion script (`scripts/import-bank.*`) from their format
   into the JSON files. Run the bank tests and fix or report every question that fails validation.

## Step 9: Later, not part of the MVP (keep in mind, don't build)

When accounts or teacher-edited questions are needed:
- Load `topics.json` and the question files into PostgreSQL tables (topics, questions, test_cases) with a script.
- Serve them from `server/` and swap `bank.ts`/`progressStore.js` to call the API; pages stay the same.
- Mark answers on the server with the same `checkAnswer` (it's in `shared/`) so solutions and hidden tests
  never reach the browser.
- On a student's first login, upload their localStorage progress into their account.
