# Pseudocode rules

Reference material for the Pseudocode Practice app's interpreters. Everything here describes **how Cambridge pseudocode should behave in this app**: what the official documents say, and the extra decisions we made where they say nothing or contradict themselves.

## Files

| File | What it is |
|---|---|
| `pseudocode-rules-olevel-2210.json` | O Level 2210 rules: syntax templates, built-in functions, examples, errata, open questions. Rule IDs look like `O-IF-1`. |
| `pseudocode-grammar-olevel-2210.ebnf` | Formal O Level grammar (W3C EBNF). The exact syntax a parser should accept, with the layout (indentation) rules at the end. |
| `pseudocode-rules-as-alevel-9618.json` | AS & A Level 9618 rules, including the exam-insert functions. Rule IDs look like `IF-1`. *(No grammar file yet; the interpreter supports the AS part.)* |

**Sources**
- O Level: *Cambridge O Level Computer Science 2210 syllabus, 2026–2028* (697287), section 4 "Pseudocode" and topic 8.
- A Level: *Pseudocode Guide for Teachers, 9618, 2026* (697401) and the 9618/21 Paper 2 inserts for May/June 2024 (673618) and 2025, which are word-for-word identical.

In the JSON files, any rule marked `"policy": true` is **our** decision, not Cambridge's.

## How an interpreter should use these files

Run the program through four steps. Steps 1–3 happen **before anything runs**, like a compiler, so a mistake in a branch that never executes is still reported.

```
source ──► 1 Lexer ──► 2 Layout check ──► 3 Parser + static checks ──► 4 Interpreter (step-by-step)
```

1. **Lexer**: splits each line into tokens (grammar §1). Rejects lower-case keywords, reserved words used as names, A Level-only words (`BYREF`, `MID`, `&`, …) and typographic characters copied from PDFs (`–` `“ ”` `‘ ’`).
2. **Layout check**: tabs only, one per level (grammar §10).
3. **Parser + static checks**: builds the program tree from the grammar, then checks declarations, types, scope, `CALL` usage, `RETURN` placement and define-before-use. See [Errors and warnings](#errors-and-warnings).
4. **Interpreter**: walks the tree one statement at a time. This is what makes stepping, trace tables, variable watches, live `INPUT` and runaway-loop limits easy.

**Why interpret instead of compiling:** learner programs are tiny, so speed doesn't matter. Stepping through code, filling in trace tables (a core exam skill) and getting errors that point at the student's own line all matter far more, and they are much simpler with an interpreter. The checks before running give students compiler-style feedback anyway.

## Design decisions we made

These apply to **both levels** unless the table says otherwise.

| Decision | Why |
|---|---|
| **One tab per indent level.** The official documents use 3 spaces (A Level) or 4 spaces (O Level), with THEN/ELSE half-indented by 2. | One key press per level, no counting spaces, and the same at both levels. THEN/ELSE get a full level of their own. |
| **O Level IF layout:** `IF` + condition on one line, then `THEN` alone one tab in, then statements one more tab in. `ELSE` matches `THEN`. | Matches the syllabus structure while keeping whole-tab indentation. |
| **Brackets are required wherever the official documents don't state an order of operations.** Only `*` `/` before `+` `-` may be relied on. | Brackets are never wrong in an exam, but relying on an unstated order can cost marks. This teaches students the safe habit. It is deliberately stricter than the documents: even the syllabus's `Pi * Radius ^ 2` and `IF Answer < 0 OR Answer > 100` are errors here. |
| **Every variable must be declared**, including FOR loop variables. | The documents only call this good practice, but declaring first is a habit worth enforcing, and it makes full type checking possible. |
| **Keywords must be UPPER CASE.** | It's how every exam paper writes them. |
| **`<-` is accepted when typed and shown as `←`.** | Students can't easily type `←`. |
| **`CALL` for procedures only, never for functions.** This includes procedure methods at A Level (`CALL Player.SetAttempts(5)`). | The documents state this for plain procedures but leave it out in the A Level OOP examples; we made it consistent. |
| **Define before use.** Code inside a subroutine may call subroutines defined further down. A line outside any subroutine may only call X if X, and everything X calls, is defined above that line. | Pseudocode has no `main`, so this behaves like a compiled language would. The official examples (`DefaultSquare` calling `Square`, `DefaultLine` calling `Line`) stay valid. |
| **`RETURN` inside a procedure is an error.** | Procedures don't return values. |
| **String and character equality is exact and case-sensitive.** `"a" = "a"` is TRUE, `"a" = "A"` is FALSE. | Stated in the A Level insert; applied to O Level too. |
| **Every `OUTPUT` starts a new line.** Values separated by commas (or joined with `&` at A Level) stay on that line, with nothing added between them. | The usual behaviour, and it gives predictable output for marking. |
| **Variables that are never assigned hold a random value of their type.** | Shows students why initialising matters. Reading one is not an error, but the trace view should highlight it. |
| **Variables declared inside a subroutine are local**, and so are parameters. | Matches the syllabus's local/global topic. |
| **No shadowing (O Level).** A local variable or parameter can't share a name (in any letter case) with anything global. | Two variables with one name is a common source of confusion for beginners, so it's an error instead. |
| **Arrays can be passed as parameters (O Level)**, written with their full type: `PROCEDURE ShowAll(Scores : ARRAY[1:10] OF INTEGER)`. | Lets students write reusable subroutines without relying on global arrays. Like everything at O Level it is by value: the subroutine gets a copy. |
| **Names start with a letter; a lower-case start is only a warning (O Level).** Single letters like `i`, `j`, `n` give no warning. | The syllabus says "must start with a capital", but breaking that shouldn't stop a program from running. |
| **Open files are global (O Level).** Once `OPENFILE` has run, the file works from anywhere until `CLOSEFILE`. | Files belong to the running program, not to a procedure; this is checked while running, not per scope. |
| **`DIV`, `MOD`, `INT` and `ROUND` truncate toward zero.** `DIV(-7, 2)` = -3, `MOD(-7, 2)` = -1, `ROUND(2.7, 0)` = 2. | DIV ("fractional part discarded") and INT ("integer part") are truncation in the documents. ROUND is truncation by our choice, so every number-cutting routine behaves the same way. |
| **Strings start at position 1.** | The syllabus allows 0 or 1 but its example uses 1. |
| **O Level `DIV` / `MOD` are written as functions only**, `DIV(10, 3)`. | Exactly as the syllabus writes them. A Level keeps `10 DIV 3`. |
| **O Level accepts both forms for:** `OTHERWISE` with or without a colon; CASE branches with ranges (`90 TO 99`) and several statements; brackets on no-parameter procedures and functions (`PROCEDURE Beep` or `PROCEDURE Beep()`, `CALL Beep` or `CALL Beep()`). | Harmless differences from A Level that students commonly mix up. |
| **O Level keeps its own form only for:** THEN/ELSE on separate lines, `WHILE … DO`, `CONSTANT X ← 5`, and identifiers made of letters and digits only (no underscore). | These are what O Level papers expect. |
| **No `BYREF` / `BYVAL` at O Level; A Level defaults to `BYVAL`.** At A Level, a `BYREF` also applies to the parameters after it. | Straight from the documents. |
| **Enumerated types (A Level) don't wrap.** `Winter + 1` is an error. | Wrapping would hide off-by-one mistakes. |
| **A Level function names follow the exam insert.** The insert uses `TO_UPPER` and `TO_LOWER`, not `UCASE` and `LCASE`. | In Paper 2 the insert is the authority. |

## Where we differ from the official documents

Both JSON files have a `sourceErrata` list of mistakes or inconsistencies in the official documents, for example:
- The A Level `Cat` class declares `Breed` as INTEGER but stores a STRING in it.
- The O Level `SWAP` can't work, because there is no BYREF.
- The O Level procedure example declares a variable named `Length`, which clashes with the `LENGTH` function.

Examples in our files are corrected versions; the errata lists record what the originals said.

## Errors and warnings

**Errors** stop the program. **Warnings** are shown but the program still runs.

**Before running (static errors):**
- syntax that doesn't match the grammar, including any operator mix without brackets
- a keyword not in upper case, or a keyword or function name used as an identifier
- indentation that isn't exactly one tab per level
- a variable used without `DECLARE`, a duplicate declaration in the same scope, or an identifier that breaks the naming rules
- O Level: a local variable or parameter with the same name as something global
- passing an array whose dimensions, bounds or element type don't match the parameter
- a type mismatch in an assignment, argument, operator or condition (conditions must be BOOLEAN)
- assigning to a constant, or a constant whose value isn't a literal
- `CALL` used with a function, a procedure used inside an expression, or the wrong number or types of arguments
- `RETURN` outside a function
- a top-level call before the subroutine (or anything it calls) has been defined
- a CASE label whose type doesn't match the subject
- O Level only: `BYREF`/`BYVAL`, `10 DIV 3`, and other A Level-only syntax

**While running (runtime errors):**
- array index out of range
- `DIV` or `MOD` by zero, or `/` by zero
- `SUBSTRING` start or length out of range
- `INPUT` text that can't be converted to the target's type
- `READFILE` past the end of the file (O Level has no `EOF`), or reading, writing or closing a file that hasn't been opened in the right mode by an earlier `OPENFILE` (from anywhere in the program)
- `STEP 0` in a FOR loop
- a function reaching `ENDFUNCTION` without executing `RETURN`
- A Level: `Winter + 1`-style enum overflow
- the step limit being reached, which almost always means an infinite loop

**Warnings:**
- a comment line not indented like the code below it
- an identifier written in different letter case from its declaration (`total` vs `Total`)
- O Level: a name starting with a lower-case letter (except single letters such as `i`, `j`, `n`)
- O Level: a procedure or function with more than 3 parameters (exam questions never use more)
- reading a variable that was never assigned (it holds a random value)
- overlapping CASE labels, where a later clause can never run
- a file still open when the program ends; it is closed automatically

## O Level interpreter decisions

Building an interpreter forces decisions the syllabus never mentions. These were proposed and agreed (P-SUB-3 and P-SCOPE-1 were changed on review).

| ID | Proposal |
|---|---|
| P-TYPE-1 | An INTEGER value may be stored in a REAL variable, and a CHAR in a STRING. Every other mismatch is an error. In particular REAL → INTEGER is an error: use `ROUND(x, 0)` or `DIV`. |
| P-TYPE-2 | `ROUND(x, 0)` gives an INTEGER; `ROUND(x, n)` with n > 0 gives a REAL. |
| P-TYPE-3 | `/` always gives REAL. `^` gives INTEGER when both sides are INTEGER (a negative exponent is then a runtime error), otherwise REAL. |
| P-TYPE-4 | A CHAR can be compared with a STRING of length 1 (`'A' = "A"` is TRUE), as in the A Level insert. |
| P-TYPE-5 | `+` does not join strings; there is no concatenation at O Level. To print values together, use commas in `OUTPUT`. |
| P-FOR-1 | `NEXT` must name the same variable as its `FOR`. |
| P-FOR-2 | Assigning to the loop variable inside the loop is an error. |
| P-FOR-3 | The start, end and STEP values are worked out once, when the loop starts. |
| P-SUB-1 | Procedures and functions can only be defined at the top level, never inside another subroutine or block. |
| P-SUB-2 | Recursion is allowed. |
| P-SUB-3 | Arrays can be passed, by value (a copy), with the full array type in the parameter. The argument's dimensions, bounds and element type must match. |
| P-SCOPE-1 | No shadowing: a local or parameter with the same name as anything global is an error. |
| P-SCOPE-2 | A global used inside a subroutine must be declared above any top-level call that reaches that subroutine (the same rule as define-before-use). |
| P-ARR-1 | Array bounds are integer literals or INTEGER constants, with lower ≤ upper. Copying a whole array in one assignment (`A ← B`) is not allowed; passing an array as an argument is (P-SUB-3). |
| P-CASE-1 | The CASE subject is a plain variable (not an array element or expression); labels are literals. |
| P-IO-1 | REAL values are shown with at least one decimal place (`4.0`), BOOLEANs as `TRUE`/`FALSE`. |
| P-FILE-1 | Each `READFILE` reads the next line and converts it to the target's type. Each `WRITEFILE` writes one line. Files live in a simulated in-browser file system. |
| P-LEX-1 | Strings and chars have no escape sequences, so a string can't contain `"` and a CHAR can't be `'`. |
| P-UNINIT-1 | "Random" uninitialised values come from a small, readable range (for example INTEGER −999…999, a short random STRING), so the trace view stays legible. |

## Decisions made while building the O Level interpreter

The interpreter is in `interpreter/` (run its tests with `npm test` from the project root). These points weren't covered above, so they were decided while building it. Change any of them if you disagree.

| Decision | Why |
|---|---|
| `AND` / `OR` always evaluate both sides (no short-circuit). In `WHILE (i <= 10) AND (List[i] <> 0) DO`, reading `List[11]` is reported as "index out of range" and the program stops. | An error anywhere in a condition is reported, never hidden because the other side already decided the answer. |
| After a FOR loop ends, its variable holds the first value past the end (`FOR i ← 1 TO 3` leaves `i` = 4). If the loop never ran, it holds the start value. | The usual behaviour in languages with a counted FOR loop. |
| REAL output hides tiny floating-point noise (15 significant digits): `0.1 + 0.2` shows `0.3`. | Students shouldn't see `0.30000000000000004`. |
| `DECLARE` inside a loop doesn't reset the variable each time round. Every variable exists from the start of its program or subroutine call. | Declarations are checked before the program runs, so running them again has nothing to do. |
| Mistyped words: `ELSEIF`, `ENDFOR`, `ENDREPEAT`, `PRINT`, `BYREF`, `BYVAL` are errors however they're written. `MID`, `LEFT`, `RIGHT`, `INT`, `RAND`, `EOF`, `APPEND`, `TYPE`, `CLASS` are errors only in capitals. | So a student can still name a variable `Left` or `Type`. |
| `INPUT` and `READFILE` ignore spaces around a number or TRUE/FALSE. A STRING keeps everything typed. | Stray spaces are easy to type by accident. |
| Limits: 2,000,000 steps, 500 nested calls, 10,000 output lines, 100,000 array elements. | Stops endless loops and endless recursion quickly, with a clear message. |

## AS Level interpreter decisions

The same interpreter runs both levels: `compile(source, "O")` or `compile(source, "AS")`. The AS version follows `pseudocode-rules-as-alevel-9618.json`. These points were decided while building it.

| Decision | Why |
|---|---|
| **Only the AS part of 9618 is supported.** Records (`TYPE … ENDTYPE`), DATE, BYREF/BYVAL and text files (READ, WRITE, APPEND, EOF) work. Enumerated, pointer and set types, random files (`SEEK`, `GETRECORD`, `PUTRECORD`, `FOR RANDOM`) and classes give an "A Level only" error. | The page offers O Level and AS Level. A Level (Paper 4) features can be added later. |
| `IF` is treated as a keyword. | It is missing from the rules file's `keywords` list, but the guide uses it everywhere. |
| The guide's CASE example writes `CALL Beep`, but rule PROC-4 says brackets are always required. PROC-4 wins: `CALL Beep()`. | The rules file contradicts itself, and following PROC-4 keeps one rule for every call. |
| `OTHERWISE` needs its colon at AS (`OTHERWISE : …`). | The README's design table only lets O Level accept both forms. |
| A date written `DD/MM/YYYY` with no spaces, such as `04/10/2003`, is a DATE literal, as in the exam insert. Dates are shown as `DD/MM/YYYY`. | Matches the insert's examples. Dividing literal numbers in that exact pattern is very unlikely. |
| A STRING can be stored in a CHAR if it has exactly one character. A literal is checked before running; anything else is checked while running. | FN-CHAR-1 and FN-CHAR-3. |
| `STR_TO_NUM(…)` can be stored straight into an INTEGER if the number is whole (checked while running). Anywhere else it is a REAL. | The insert says it returns "REAL or INTEGER", and students often write `N ← STR_TO_NUM(Text)`. |
| `READFILE` needs a STRING variable. `WRITEFILE` takes any STRING or CHAR value, not only a variable. | FILE-4 and the guide's examples. Numbers go through `STR_TO_NUM` / `NUM_TO_STR`. |
| `LCASE` / `UCASE` take a CHAR only (a one-character STRING literal is fine). For a whole STRING, use `TO_LOWER` / `TO_UPPER`. | The guide's definitions. |
| `LEFT`, `RIGHT` and `MID` allow a length of 0. `CHR` needs 0–127. `RAND(x)` needs x > 0. | "Invalid values are errors" (FN-1b); these are the invalid ones. |
| No shadowing rule at AS: a local variable or parameter can share a name with a global, and the local one is used. | The README's no-shadowing rule is marked O Level only. |
| Whole arrays and records can be assigned when the types match exactly (ARR-6, UDT-2). They are copied. | From the guide. |
| BYREF arguments must be a variable, array element or record field of exactly the parameter's type (no INTEGER-to-REAL widening). Constants and FOR loop variables can't be passed BYREF. | The procedure writes straight into the caller's variable, so the types must match. |
| Functions can return a record but not an array. | The guide only shows `RETURNS <data type>`. |
| AS layout: `IF … THEN` at depth d, statements d+1, `ELSE` and `ENDIF` at d. Record fields are one tab in from `TYPE`. | FMT-IND-2 in the rules file. |

## Still open

- **String ordering with `<` and `>`** (both levels). Default: character by character by ASCII code, so `"Z" < "a"` is TRUE.
