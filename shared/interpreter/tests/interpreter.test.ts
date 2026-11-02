import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, runSource } from "../index.ts";

const rules = JSON.parse(readFileSync(new URL("../../pseudocode-rules-olevel-2210.json", import.meta.url), "utf8"));

/** Lines joined with \n; a leading "|" on each line is stripped so tabs are visible in the test source. */
const src = (...lines: string[]) => lines.join("\n");

const errors = (source: string) => compile(source).diagnostics.filter((d) => d.severity === "error");
const warnings = (source: string) => compile(source).diagnostics.filter((d) => d.severity === "warning");

function expectError(source: string, pattern: RegExp, line?: number) {
  const errs = errors(source);
  const hit = errs.find((e) => pattern.test(e.message) && (line === undefined || e.line === line));
  assert.ok(hit, `Expected an error matching ${pattern}${line ? ` on line ${line}` : ""}. Got:\n${errs.map((e) => `  L${e.line}: ${e.message}`).join("\n") || "  (none)"}`);
}

function expectNoErrors(source: string) {
  const errs = errors(source);
  assert.equal(errs.length, 0, `Expected no errors. Got:\n${errs.map((e) => `  L${e.line}: ${e.message}`).join("\n")}`);
}

function run(source: string, inputs: string[] = [], files?: Record<string, string>) {
  const r = runSource(source, { inputs, files, random: () => 0.5 });
  const errs = r.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errs.length, 0, `Program didn't compile:\n${errs.map((e) => `  L${e.line}: ${e.message}`).join("\n")}`);
  return r;
}

function output(source: string, inputs: string[] = []) {
  const r = run(source, inputs);
  assert.equal(r.error, null, `Runtime error: ${r.error?.message}`);
  return r.output;
}

function runtimeError(source: string, pattern: RegExp, inputs: string[] = [], files?: Record<string, string>) {
  const r = run(source, inputs, files);
  assert.ok(r.error, "Expected a runtime error, but the program finished.");
  assert.match(r.error.message, pattern);
  return r.error;
}

// ---------------------------------------------------------------------------

describe("lexer", () => {
  test("lower-case keywords are errors", () => {
    expectError(src("DECLARE X : INTEGER", "x ← 1", "output X"), /capitals: OUTPUT, not output/);
  });
  test("<- is accepted as ←", () => {
    assert.deepEqual(output(src("DECLARE X : INTEGER", "X <- 5", "OUTPUT X")), ["5"]);
  });
  test("underscores are not allowed in names", () => {
    expectError("DECLARE First_Name : STRING", /no underscore.*FirstName/);
  });
  test("keywords can't be names", () => {
    expectError("DECLARE Length : INTEGER", /"Length" can't be used as a name.*built-in function/);
  });
  test("typography copied from PDFs", () => {
    expectError("OUTPUT “Hello”", /straight double quotes/);
    expectError(src("DECLARE X : INTEGER", "X ← 5 – 2"), /normal minus sign/);
  });
  test("REAL literals need digits on both sides", () => {
    expectError(src("DECLARE X : REAL", "X ← .5"), /0\.5/);
    expectError(src("DECLARE X : REAL", "X ← 4."), /4\.0/);
  });
  test("A Level words are rejected", () => {
    expectError("PROCEDURE P(BYREF X : INTEGER)\nENDPROCEDURE", /BYREF is A Level only/);
    expectError(src("DECLARE S : STRING", "S ← \"a\" & \"b\""), /& is A Level only/);
    expectError(src("DECLARE S : STRING", "S ← MID(\"abc\", 1, 1)"), /SUBSTRING/);
  });
  test("a CHAR holds one character", () => {
    expectError(src("DECLARE C : CHAR", "C ← 'AB'"), /exactly one character/);
  });
});

describe("parser", () => {
  const decls = "DECLARE A : INTEGER\nDECLARE B : INTEGER\nDECLARE C : INTEGER\nDECLARE Pi : REAL\nDECLARE Radius : REAL\nDECLARE Answer : INTEGER\nDECLARE Score : INTEGER\nDECLARE MaxMark : INTEGER\nDECLARE R : BOOLEAN\nDECLARE P : BOOLEAN\nDECLARE Q : BOOLEAN\nDECLARE S : BOOLEAN";

  test("bracket rule: the syllabus's invalid examples are errors", () => {
    expectError(src(decls, "Pi ← Pi * Radius ^ 2"), /Pi \* \(Radius \^ 2\)/);
    expectError(src(decls, "R ← Answer < 0 OR Answer > 100"), /\(Answer < 0\) OR \(Answer > 100\)/);
    expectError(src(decls, "R ← NOT P AND Q"), /\(NOT P\) AND Q/);
    expectError(src(decls, "R ← P AND Q OR S"), /AND and OR can't be mixed/);
    expectError(src(decls, "R ← A < B < C"), /can't be chained/);
    expectError(src(decls, "A ← -A ^ 2"), /brackets/);
    expectError(src(decls, "Pi ← 2 ^ -1"), /brackets/);
  });
  test("bracket rule: valid examples are accepted", () => {
    for (const line of [
      "Pi ← Pi * (Radius ^ 2)", "R ← (Answer < 0) OR (Answer > 100)", "R ← (NOT P) AND Q", "R ← (P AND Q) OR S",
      "A ← Score * 100 / MaxMark * 1", "A ← A + B * C - 4", "R ← P AND Q AND S", "A ← (-A) ^ 2", "A ← -(A ^ 2)",
      "R ← A + 1 > B * 2", "R ← A ^ 2 > 4", "A ← A - -B",
    ].map((l) => l.replace("A ← Score * 100 / MaxMark * 1", "Pi ← Score * 100 / MaxMark"))) {
      expectNoErrors(src(decls, line));
    }
  });
  test("rules file examples of the bracket rule", () => {
    const rule = rules.operators.precedence.rules.find((r: { id: string }) => r.id === "O-OP-2");
    for (const ex of rule.invalidExamples as string[]) {
      const ds = errors(src("DECLARE Pi : REAL", "DECLARE Radius : REAL", "DECLARE Answer : INTEGER", "DECLARE A : BOOLEAN", "DECLARE B : BOOLEAN", "DECLARE C : BOOLEAN", "DECLARE X : BOOLEAN", "DECLARE Y : REAL",
        /[<>=]|AND|OR|NOT/.test(ex) ? `X ← ${ex}` : `Y ← ${ex}`));
      assert.ok(ds.some((d) => /brackets|mixed/.test(d.message)), `expected bracket error for ${ex}`);
    }
  });
  test("IF ... THEN on one line is an error", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "IF X > 0 THEN", "\t\tOUTPUT X", "ENDIF"), /THEN goes on its own line/);
  });
  test("WHILE needs DO", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "WHILE X < 5", "\tX ← X + 1", "ENDWHILE"), /WHILE needs DO/);
  });
  test("DIV and MOD are functions only", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 10 DIV 3"), /DIV\(A, B\)/);
  });
  test("CONSTANT uses the arrow", () => {
    expectError("CONSTANT X = 5", /use ←, not =/);
    expectError("CONSTANT X ← 2 + 3", /written directly/);
  });
  test("assignment uses the arrow", () => {
    expectError(src("DECLARE X : INTEGER", "X = 5"), /Use ← to assign/);
  });
  test("NEXT must name the FOR variable", () => {
    expectError(src("DECLARE i : INTEGER", "DECLARE j : INTEGER", "FOR i ← 1 TO 3", "\tOUTPUT i", "NEXT j"), /NEXT i/);
    expectError(src("DECLARE i : INTEGER", "FOR i ← 1 TO 3", "\tOUTPUT i", "NEXT"), /NEXT must name/);
  });
  test("ELSEIF is rejected", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "IF X = 1", "\tTHEN", "\t\tOUTPUT 1", "\tELSEIF X = 2", "ENDIF"), /no ELSEIF/);
  });
  test("missing ENDIF is reported once at the IF", () => {
    const errs = errors(src("DECLARE X : INTEGER", "X ← 1", "WHILE X < 3 DO", "\tIF X = 1", "\t\tTHEN", "\t\t\tOUTPUT X", "\tX ← X + 1", "ENDWHILE"));
    assert.equal(errs.length, 1, errs.map((e) => e.message).join("\n"));
    assert.match(errs[0].message, /IF on line 4 needs a matching ENDIF/);
  });
  test("stray closer", () => {
    expectError(src("OUTPUT 1", "ENDIF"), /ENDIF has no matching IF/);
  });
  test("subroutines only at the top level", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "IF X = 1", "\tTHEN", "\t\tPROCEDURE P", "\t\tENDPROCEDURE", "ENDIF"), /top level/);
  });
  test("one variable per DECLARE", () => {
    expectError("DECLARE A, B : INTEGER", /one variable per DECLARE/);
  });
  test("RETURNS, not RETURN, in the header", () => {
    expectError(src("FUNCTION F RETURN INTEGER", "\tRETURN 1", "ENDFUNCTION"), /RETURNS \(with an S\)/);
  });
});

describe("layout", () => {
  test("spaces are an error", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "IF X = 1", "    THEN", "        OUTPUT X", "ENDIF"), /tabs only/);
  });
  test("wrong number of tabs", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "IF X = 1", "\tTHEN", "\tOUTPUT X", "ENDIF"), /2 tabs, but it has 1 tab/, 5);
  });
  test("the grammar's layout example is valid", () => {
    expectNoErrors(src(
      "PROCEDURE Check(Score : INTEGER)",
      "\tIF (Score < 0) OR (Score > 100)",
      "\t\tTHEN",
      "\t\t\tOUTPUT \"Invalid\"",
      "\t\tELSE",
      "\t\t\tCASE OF Score",
      "\t\t\t\t100 : OUTPUT \"Perfect\"",
      "\t\t\t\t90 TO 99 : OUTPUT \"Great\"",
      "\t\t\t\t\tOUTPUT \"Nearly perfect\"",
      "\t\t\t\tOTHERWISE OUTPUT \"Keep going\"",
      "\t\t\tENDCASE",
      "\tENDIF",
      "ENDPROCEDURE",
      "",
      "CALL Check(95)",
    ));
  });
  test("comment indentation is a warning", () => {
    const ws = warnings(src("DECLARE X : INTEGER", "\t// set X", "X ← 1"));
    assert.ok(ws.some((w) => /Indent this comment/.test(w.message)));
  });
});

describe("static checks", () => {
  test("undeclared variable", () => {
    expectError("X ← 5", /X hasn't been declared/);
  });
  test("use before DECLARE", () => {
    expectError(src("X ← 5", "DECLARE X : INTEGER"), /before its DECLARE on line 2/);
  });
  test("duplicate declaration", () => {
    expectError(src("DECLARE X : INTEGER", "DECLARE x : REAL"), /already declared/);
  });
  test("REAL can't be stored in INTEGER, INTEGER can be stored in REAL", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 7 / 2"), /ROUND\(Value, 0\)/);
    expectNoErrors(src("DECLARE X : REAL", "X ← 7"));
    expectNoErrors(src("DECLARE S : STRING", "S ← 'A'"));
    expectError(src("DECLARE C : CHAR", "C ← \"A\""), /single quotes: 'A'/);
  });
  test("+ does not join strings", () => {
    expectError(src("DECLARE S : STRING", "S ← \"a\" + \"b\""), /can't join text/);
  });
  test("conditions must be BOOLEAN", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "WHILE X DO", "\tX ← X - 1", "ENDWHILE"), /must be TRUE or FALSE/);
  });
  test("constants can't be assigned", () => {
    expectError(src("CONSTANT Rate ← 6.50", "Rate ← 7.0"), /constant/);
  });
  test("FOR loop variable rules", () => {
    expectError(src("FOR i ← 1 TO 3", "\tOUTPUT 1", "NEXT i"), /i hasn't been declared/);
    expectError(src("DECLARE i : INTEGER", "FOR i ← 1 TO 3", "\ti ← 5", "NEXT i"), /can't be changed in the loop/);
    expectError(src("DECLARE R : REAL", "FOR R ← 1 TO 3", "\tOUTPUT R", "NEXT R"), /must be an INTEGER/);
    expectError(src("DECLARE i : INTEGER", "FOR i ← 1 TO 3 STEP 0", "\tOUTPUT i", "NEXT i"), /STEP can't be 0/);
  });
  test("CALL is for procedures only", () => {
    expectError(src("FUNCTION F RETURNS INTEGER", "\tRETURN 1", "ENDFUNCTION", "CALL F"), /can't be used with CALL/);
    expectError(src("PROCEDURE P", "\tOUTPUT 1", "ENDPROCEDURE", "DECLARE X : INTEGER", "X ← P"), /procedure, so it doesn't give back a value/);
  });
  test("RETURN placement", () => {
    expectError(src("PROCEDURE P", "\tRETURN 1", "ENDPROCEDURE"), /PROCEDURE can't use RETURN/);
    expectError("RETURN 1", /only be used inside a FUNCTION/);
  });
  test("argument count and types", () => {
    expectError(src("PROCEDURE P(A : INTEGER)", "\tOUTPUT A", "ENDPROCEDURE", "CALL P(1, 2)"), /needs 1 value, but 2 were given/);
    expectError(src("PROCEDURE P(A : INTEGER)", "\tOUTPUT A", "ENDPROCEDURE", "CALL P(\"x\")"), /A needs an INTEGER value/);
  });
  test("define before use (O-SUB-1 examples)", () => {
    const rule = rules.subroutines.general.find((r: { id: string }) => r.id === "O-SUB-1");
    expectNoErrors(rule.validExample);
    expectError(rule.invalidExample.replace("   // error: B is not defined yet", ""), /Move B above line 5/);
  });
  test("a global used in a subroutine must be declared before the call (P-SCOPE-2)", () => {
    expectError(src("PROCEDURE P", "\tOUTPUT Total", "ENDPROCEDURE", "CALL P", "DECLARE Total : INTEGER"), /declared on line 5, after this call/);
  });
  test("no shadowing", () => {
    expectError(src("DECLARE Total : INTEGER", "PROCEDURE P", "\tDECLARE Total : INTEGER", "\tTotal ← 1", "ENDPROCEDURE"), /can't share a name/);
    expectError(src("DECLARE Total : INTEGER", "PROCEDURE P(total : INTEGER)", "\tOUTPUT total", "ENDPROCEDURE"), /can't share a name/);
  });
  test("locals can't be used outside their subroutine", () => {
    expectError(src("PROCEDURE P", "\tDECLARE Count : INTEGER", "\tCount ← 1", "ENDPROCEDURE", "OUTPUT Count"), /local variable of P/);
  });
  test("arrays", () => {
    expectError(src("DECLARE A : ARRAY[1:10] OF INTEGER", "DECLARE B : ARRAY[1:10] OF INTEGER", "A ← B"), /one element at a time/);
    expectError(src("DECLARE A : ARRAY[1:10] OF INTEGER", "OUTPUT A[1, 2]"), /1D array/);
    expectError(src("DECLARE A : ARRAY[1:10] OF INTEGER", "OUTPUT A[1.5]"), /index must be an INTEGER/);
    expectError("DECLARE A : ARRAY[10:1] OF INTEGER", /lower bound/);
    expectNoErrors(src("CONSTANT Size ← 5", "DECLARE A : ARRAY[1:Size] OF INTEGER"));
  });
  test("array parameters must match", () => {
    expectError(src("PROCEDURE P(S : ARRAY[1:10] OF INTEGER)", "\tOUTPUT S[1]", "ENDPROCEDURE", "DECLARE A : ARRAY[1:5] OF INTEGER", "CALL P(A)"), /must match/);
  });
  test("CASE labels match the subject type", () => {
    expectError(src("DECLARE C : CHAR", "C ← 'A'", "CASE OF C", "\t1 : OUTPUT 1", "ENDCASE"), /must be a CHAR too/);
    const ws = warnings(src("DECLARE N : INTEGER", "N ← 5", "CASE OF N", "\t1 TO 10 : OUTPUT 1", "\t5 : OUTPUT 2", "ENDCASE"));
    assert.ok(ws.some((w) => /can never run/.test(w.message)));
  });
  test("style warnings", () => {
    assert.ok(warnings("DECLARE total : INTEGER").some((w) => /capital letter/.test(w.message)));
    assert.equal(warnings("DECLARE i : INTEGER").length, 0);
    assert.ok(warnings(src("DECLARE Total : INTEGER", "TOTAL ← 1")).some((w) => /same capital letters/.test(w.message)));
    assert.ok(warnings(src("PROCEDURE P(A : INTEGER, B : INTEGER, C : INTEGER, D : INTEGER)", "\tOUTPUT A", "ENDPROCEDURE")).some((w) => /more than 3/.test(w.message)));
  });
});

describe("running programs", () => {
  test("OUTPUT joins values with nothing between them; REAL shows a decimal place", () => {
    assert.deepEqual(output(src(
      "DECLARE Lives : INTEGER", "Lives ← 3", "OUTPUT \"You have \", Lives, \" lives left\"",
      "OUTPUT 4.0, \" \", 10 / 4, \" \", 0.1 + 0.2, \" \", TRUE",
    )), ["You have 3 lives left", "4.0 2.5 0.3 TRUE"]);
  });
  test("built-in functions (rules file examples)", () => {
    const fns = [...rules.builtInFunctions.integerDivision, ...rules.builtInFunctions.other.filter((f: { name: string }) => f.name === "ROUND")];
    for (const f of fns) {
      for (const ex of f.examples) assert.deepEqual(output(`OUTPUT ${ex.call}`), [ex.returns], ex.call);
    }
    for (const f of rules.builtInFunctions.string) {
      assert.deepEqual(output(`OUTPUT ${f.example.call}`), [f.example.returns.replace(/^["']|["']$/g, "")], f.example.call);
    }
  });
  test("ROUND(x, 0) is an INTEGER, ROUND(x, n) is a REAL", () => {
    assert.deepEqual(output(src("DECLARE N : INTEGER", "N ← ROUND(9.99, 0)", "OUTPUT N, \" \", ROUND(2.3, 1), \" \", ROUND(5, 2)")), ["9 2.3 5.0"]);
  });
  test("integer and real arithmetic", () => {
    assert.deepEqual(output("OUTPUT 2 ^ 10, \" \", 2.0 ^ 3, \" \", 7 - 10, \" \", -(3 * 4)"), ["1024 8.0 -3 -12"]);
  });
  test("string comparisons", () => {
    assert.deepEqual(output("OUTPUT \"a\" = \"A\", \" \", 'A' = \"A\", \" \", \"Z\" < \"a\", \" \", \"apple\" < \"banana\""), ["FALSE TRUE TRUE TRUE"]);
  });
  test("the nested IF example", () => {
    const prog = src(
      "DECLARE ChallengerScore : INTEGER", "DECLARE ChampionScore : INTEGER", "DECLARE HighestScore : INTEGER",
      "DECLARE ChallengerName : STRING", "DECLARE ChampionName : STRING",
      "INPUT ChallengerName", "INPUT ChallengerScore", "INPUT ChampionName", "INPUT ChampionScore", "INPUT HighestScore",
      rules.selection.if.example,
    );
    assert.deepEqual(output(prog, ["Ali", "90", "Sara", "80", "85"]), ["Ali is champion and highest scorer"]);
    assert.deepEqual(output(prog, ["Ali", "70", "Sara", "80", "75"]), ["Sara is still the champion", "Sara is also the highest scorer"]);
  });
  test("the CASE example", () => {
    const prog = src("DECLARE Move : CHAR", "DECLARE Position : INTEGER", "Position ← 50", rules.selection.case.example, "OUTPUT Position");
    assert.deepEqual(output(prog, ["W"]), ["40"]);
    assert.deepEqual(output(prog, ["D"]), ["51"]);
    assert.deepEqual(output(prog, ["X"]), ["Beep", "50"]);
  });
  test("CASE ranges and several statements", () => {
    const prog = src(
      "DECLARE Score : INTEGER", "INPUT Score", "CASE OF Score",
      "\t100 : OUTPUT \"Perfect\"", "\t90 TO 99 : OUTPUT \"Great\"", "\t\tOUTPUT \"Nearly perfect\"",
      "\tOTHERWISE : OUTPUT \"Keep going\"", "ENDCASE",
    );
    assert.deepEqual(output(prog, ["95"]), ["Great", "Nearly perfect"]);
    assert.deepEqual(output(prog, ["100"]), ["Perfect"]);
    assert.deepEqual(output(prog, ["3"]), ["Keep going"]);
  });
  test("the FOR example with a 2D array", () => {
    const prog = src(
      "CONSTANT MaxRow ← 2", "DECLARE Amount : ARRAY[1:2, 1:10] OF INTEGER",
      "DECLARE Row : INTEGER", "DECLARE Column : INTEGER", "DECLARE Total : INTEGER", "DECLARE RowTotal : INTEGER",
      "FOR Row ← 1 TO MaxRow", "\tFOR Column ← 1 TO 10", "\t\tAmount[Row, Column] ← Row * Column", "\tNEXT Column", "NEXT Row",
      rules.iteration.for.example,
    );
    assert.deepEqual(output(prog), ["Total for Row 1 is 55", "Total for Row 2 is 110", "The grand total is 165"]);
  });
  test("FOR with STEP, negative STEP and zero passes", () => {
    const prog = src("DECLARE i : INTEGER", "FOR i ← 10 TO 1 STEP -3", "\tOUTPUT i", "NEXT i", "FOR i ← 5 TO 1", "\tOUTPUT \"never\"", "NEXT i", "OUTPUT \"done\"");
    assert.deepEqual(output(prog), ["10", "7", "4", "1", "done"]);
  });
  test("the REPEAT and WHILE examples", () => {
    assert.deepEqual(output(src("DECLARE Password : STRING", rules.iteration.repeat.example, "OUTPUT \"in\""), ["a", "b", "Secret"]),
      ["Please enter the password", "Please enter the password", "Please enter the password", "in"]);
    assert.deepEqual(output(src("DECLARE Number : INTEGER", "Number ← 40", rules.iteration.while.example, "OUTPUT Number")), ["4"]);
  });
  test("functions and procedures (rules file examples)", () => {
    assert.deepEqual(output(rules.subroutines.function.example), ["Sum of squares = 500"]);
    const procs = src("DECLARE MySize : INTEGER", "CONSTANT Default ← 60", "MySize ← 3", rules.subroutines.procedure.example);
    assert.deepEqual(output(procs), ["-", "-", "-"]);
  });
  test("recursion", () => {
    const prog = src(
      "FUNCTION Factorial(N : INTEGER) RETURNS INTEGER", "\tIF N <= 1", "\t\tTHEN", "\t\t\tRETURN 1", "\tENDIF",
      "\tRETURN N * Factorial(N - 1)", "ENDFUNCTION", "OUTPUT Factorial(10)",
    );
    assert.deepEqual(output(prog), ["3628800"]);
  });
  test("RETURN takes effect immediately", () => {
    const prog = src("FUNCTION F RETURNS INTEGER", "\tRETURN 1", "\tOUTPUT \"never\"", "ENDFUNCTION", "OUTPUT F");
    assert.deepEqual(output(prog), ["1"]);
  });
  test("arrays are passed by value (a copy)", () => {
    const prog = src(
      "PROCEDURE Change(S : ARRAY[1:3] OF INTEGER)", "\tS[1] ← 99", "\tOUTPUT S[1]", "ENDPROCEDURE",
      "DECLARE A : ARRAY[1:3] OF INTEGER", "A[1] ← 1", "CALL Change(A)", "OUTPUT A[1]",
    );
    assert.deepEqual(output(prog), ["99", "1"]);
  });
  test("locals are separate on each call; parameters are by value", () => {
    const prog = src(
      "DECLARE X : INTEGER", "PROCEDURE AddOne(N : INTEGER)", "\tN ← N + 1", "\tOUTPUT N", "ENDPROCEDURE",
      "X ← 5", "CALL AddOne(X)", "OUTPUT X",
    );
    assert.deepEqual(output(prog), ["6", "5"]);
  });
  test("AND / OR evaluate both sides, so a bad array read is still an error", () => {
    const prog = src(
      "DECLARE List : ARRAY[1:3] OF INTEGER", "DECLARE i : INTEGER",
      "List[1] ← 4", "List[2] ← 5", "List[3] ← 6", "i ← 1",
      "WHILE (i <= 3) AND (List[i] <> 0) DO", "\ti ← i + 1", "ENDWHILE", "OUTPUT i",
    );
    const e = runtimeError(prog, /Index 4 is outside the array List/);
    assert.equal(e.line, 7);
    runtimeError(src("DECLARE X : INTEGER", "X ← 0", "OUTPUT (X = 0) OR (DIV(1, X) = 1)"), /DIV by zero/);
  });
  test("AND / OR give the right answers", () => {
    assert.deepEqual(output("OUTPUT TRUE AND FALSE, \" \", TRUE OR FALSE, \" \", FALSE OR FALSE, \" \", TRUE AND TRUE"), ["FALSE TRUE FALSE TRUE"]);
  });
  test("both sides run even when they call functions", () => {
    const prog = src(
      "FUNCTION Say(Word : STRING) RETURNS BOOLEAN", "\tOUTPUT Word", "\tRETURN FALSE", "ENDFUNCTION",
      "DECLARE B : BOOLEAN", "B ← Say(\"left\") AND Say(\"right\")",
    );
    assert.deepEqual(output(prog), ["left", "right"]);
  });
  test("files", () => {
    const prog = src(rules.fileHandling.example, "OPENFILE \"FileB.txt\" FOR READ", "READFILE \"FileB.txt\", LineOfText", "CLOSEFILE \"FileB.txt\"", "OUTPUT LineOfText");
    const r = run(prog, [], { "FileA.txt": "first line\nsecond line\n" });
    assert.equal(r.error, null);
    assert.deepEqual(r.output, ["first line"]);
    assert.equal(r.files["FileB.txt"], "first line");
  });
  test("RANDOM is between 0 and 1", () => {
    const r = runSource(src("DECLARE N : REAL", "N ← RANDOM()", "OUTPUT (N >= 0) AND (N <= 1)"));
    assert.deepEqual(r.output, ["TRUE"]);
  });
  test("reading an unassigned variable gives a random value and a warning", () => {
    const r = run(src("DECLARE Total : INTEGER", "OUTPUT Total + 1"));
    assert.equal(r.error, null);
    assert.equal(r.runtimeWarnings.length, 1);
    assert.match(r.runtimeWarnings[0].message, /Total was used before it was given a value/);
  });
});

describe("the page's example programs", () => {
  test("all compile with no errors or warnings", async () => {
    const examplesPath = "../../../client/src/examples.js"; // plain JS, so no types
    const { EXAMPLES } = await import(examplesPath);
    for (const ex of EXAMPLES.O as { title: string; code: string }[]) {
      const ds = compile(ex.code).diagnostics;
      assert.equal(ds.length, 0, `${ex.title}:\n${ds.map((d) => `  L${d.line}: ${d.message}`).join("\n")}`);
    }
  });
});

describe("runtime errors", () => {
  test("array index out of range", () => {
    const e = runtimeError(src("DECLARE A : ARRAY[1:5] OF INTEGER", "DECLARE i : INTEGER", "i ← 6", "A[i] ← 1"), /Index 6 is outside the array A, which goes from 1 to 5/);
    assert.equal(e.line, 4);
  });
  test("division by zero", () => {
    runtimeError(src("DECLARE X : INTEGER", "X ← 0", "OUTPUT 5 / X"), /Division by zero/);
    runtimeError(src("DECLARE X : INTEGER", "X ← 0", "OUTPUT DIV(5, X)"), /DIV by zero/);
    runtimeError(src("DECLARE X : INTEGER", "X ← 0", "OUTPUT MOD(5, X)"), /MOD by zero/);
  });
  test("SUBSTRING out of range", () => {
    runtimeError("OUTPUT SUBSTRING(\"Happy\", 4, 5)", /only has 5 characters/);
    runtimeError("OUTPUT SUBSTRING(\"Happy\", 0, 1)", /start position must be 1 or more/);
  });
  test("INPUT that can't be converted", () => {
    runtimeError(src("DECLARE Age : INTEGER", "INPUT Age"), /whole number \(INTEGER\) for Age, but got "abc"/, ["abc"]);
    runtimeError(src("DECLARE C : CHAR", "INPUT C"), /exactly one character/, ["hello"]);
  });
  test("file errors", () => {
    runtimeError(src("DECLARE S : STRING", "READFILE \"a.txt\", S"), /isn't open/);
    runtimeError(src("DECLARE S : STRING", "OPENFILE \"a.txt\" FOR READ"), /no file called "a.txt"/);
    runtimeError(src("DECLARE S : STRING", "OPENFILE \"a.txt\" FOR READ", "READFILE \"a.txt\", S", "READFILE \"a.txt\", S"), /no more lines/, [], { "a.txt": "one" });
    runtimeError(src("DECLARE S : STRING", "S ← \"x\"", "OPENFILE \"a.txt\" FOR READ", "WRITEFILE \"a.txt\", S"), /open FOR READ/, [], { "a.txt": "one" });
  });
  test("a file left open gives a warning", () => {
    const r = run(src("OPENFILE \"a.txt\" FOR WRITE"));
    assert.ok(r.runtimeWarnings.some((w) => /still open/.test(w.message)));
  });
  test("STEP 0 worked out while running", () => {
    runtimeError(src("DECLARE i : INTEGER", "DECLARE S : INTEGER", "S ← 0", "FOR i ← 1 TO 3 STEP S", "\tOUTPUT i", "NEXT i"), /STEP of this FOR loop is 0/);
  });
  test("a function that never RETURNs", () => {
    runtimeError(src("FUNCTION F RETURNS INTEGER", "\tOUTPUT 1", "ENDFUNCTION", "OUTPUT F"), /without running RETURN/);
  });
  test("infinite loops hit the step limit", () => {
    const r = runSource(src("WHILE TRUE DO", "ENDWHILE"), { stepLimit: 10_000 });
    assert.match(r.error!.message, /stopped after 10,000 steps/);
  });
  test("runaway recursion is stopped", () => {
    const r = runSource(src("FUNCTION F(N : INTEGER) RETURNS INTEGER", "\tRETURN F(N + 1)", "ENDFUNCTION", "OUTPUT F(1)"));
    assert.match(r.error!.message, /recursion/);
  });
  test("negative integer power", () => {
    runtimeError(src("DECLARE N : INTEGER", "N ← -1", "OUTPUT 2 ^ N"), /power can't be negative/);
  });
  test("too much output", () => {
    const r = runSource(src("WHILE TRUE DO", "\tOUTPUT 1", "ENDWHILE"));
    assert.match(r.error!.message, /more than 10,000 lines/);
  });
});
