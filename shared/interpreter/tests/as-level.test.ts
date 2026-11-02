import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, runSource } from "../index.ts";

const rules = JSON.parse(readFileSync(new URL("../../pseudocode-rules-as-alevel-9618.json", import.meta.url), "utf8"));

const src = (...lines: string[]) => lines.join("\n");
const errors = (source: string) => compile(source, "AS").diagnostics.filter((d) => d.severity === "error");
const warnings = (source: string) => compile(source, "AS").diagnostics.filter((d) => d.severity === "warning");

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
  const r = runSource(source, { level: "AS", inputs, files, random: () => 0.5 });
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

describe("AS syntax", () => {
  test("IF … THEN on one line, ELSE lined up with IF", () => {
    const prog = src("DECLARE X : INTEGER", "X ← 5", "IF X > 3 THEN", "\tOUTPUT \"big\"", "ELSE", "\tOUTPUT \"small\"", "ENDIF");
    assert.deepEqual(output(prog), ["big"]);
  });
  test("the O Level IF layout is an error", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 5", "IF X > 3", "\tTHEN", "\t\tOUTPUT X", "ENDIF"), /THEN goes at the end of the IF line/);
  });
  test("IF without THEN", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 5", "IF X > 3", "\tOUTPUT X", "ENDIF"), /THEN at the end of the line/);
  });
  test("WHILE has no DO", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 1", "WHILE X < 5 DO", "\tX ← X + 1", "ENDWHILE"), /WHILE has no DO/);
  });
  test("CONSTANT uses =", () => {
    expectNoErrors("CONSTANT Rate = 6.50");
    expectError("CONSTANT Rate ← 6.50", /use =, not ←/);
  });
  test("procedures and functions need brackets", () => {
    expectError(src("PROCEDURE Beep", "\tOUTPUT \"Beep\"", "ENDPROCEDURE"), /PROCEDURE Beep\(\)/);
    expectError(src("PROCEDURE Beep()", "\tOUTPUT \"Beep\"", "ENDPROCEDURE", "CALL Beep"), /CALL Beep\(\)/);
    expectError(src("FUNCTION Five() RETURNS INTEGER", "\tRETURN 5", "ENDFUNCTION", "OUTPUT Five"), /Five\(\)/);
  });
  test("OTHERWISE needs a colon", () => {
    expectError(src("DECLARE N : INTEGER", "N ← 1", "CASE OF N", "\t1 : OUTPUT 1", "\tOTHERWISE OUTPUT 2", "ENDCASE"), /colon after OTHERWISE/);
  });
  test("DIV and MOD are operators", () => {
    assert.deepEqual(output("OUTPUT 10 DIV 3, \" \", 10 MOD 3, \" \", -7 DIV 2, \" \", -7 MOD 2"), ["3 1 -3 -1"]);
    expectError(src("DECLARE X : INTEGER", "X ← DIV(10, 3)"), /DIV is an operator/);
  });
  test("& joins strings and chars; + does not", () => {
    assert.deepEqual(output("OUTPUT \"Summer\" & \" \" & \"Pudding\" & '!'"), ["Summer Pudding!"]);
    expectError(src("DECLARE S : STRING", "S ← \"a\" + \"b\""), /To join strings use &/);
    expectError(src("DECLARE S : STRING", "S ← \"Age \" & 5"), /NUM_TO_STR/);
  });
  test("there is no power operator", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 2 ^ 3"), /no power operator/);
  });
  test("underscores are allowed in names", () => {
    expectNoErrors(src("DECLARE First_Name : STRING", "First_Name ← \"Ali\""));
  });
  test("A Level only features are rejected", () => {
    expectError("TYPE Season = (Spring, Summer, Autumn, Winter)", /Enumerated types are A Level only/);
    expectError("CLASS Pet", /A Level only/);
    expectError("OPENFILE \"S.dat\" FOR RANDOM", /random files are A Level only/);
    expectError("SEEK \"S.dat\", 3", /A Level only/);
  });
  test("O Level functions are rejected", () => {
    expectError(src("DECLARE S : STRING", "S ← SUBSTRING(\"abc\", 1, 2)"), /use MID/);
    expectError(src("DECLARE N : INTEGER", "N ← ROUND(2.5, 0)"), /no ROUND at AS Level/);
  });
  test("bracket rule (OP-2 examples)", () => {
    const decls = src("DECLARE A : INTEGER", "DECLARE B : INTEGER", "DECLARE C : INTEGER", "DECLARE X : INTEGER", "DECLARE Y : INTEGER", "DECLARE R : BOOLEAN", "DECLARE P : BOOLEAN", "DECLARE Q : BOOLEAN", "DECLARE S : STRING");
    const rule = rules.operators.precedence.rules.find((r: { id: string }) => r.id === "OP-2");
    for (const ex of rule.invalidExamples as string[]) {
      const target = /AND|OR|NOT|[<>]/.test(ex) ? "R" : /&/.test(ex) ? "S" : "A";
      const bool = ex.replace(/\bA\b(?= AND| OR)/g, "P").replace(/(?<=AND |OR )B\b/g, "Q").replace(/(?<=OR )C\b/g, "R").replace(/NOT A/, "NOT P");
      const ds = errors(src(decls, `${target} ← ${target === "R" ? bool : ex}`));
      assert.ok(ds.some((d) => /brackets|mixed/.test(d.message)), `expected a bracket error for ${ex}`);
    }
    for (const ok of ["A ← A + B * C", "A ← A + (B MOD C)", "R ← (X > 5) AND (Y < 3)", "R ← (NOT P) AND Q", "R ← (P AND Q) OR R", "S ← S & \"x\" & S", "R ← A + 1 > B"]) {
      expectNoErrors(src(decls, ok));
    }
  });
  test("define before use (SUB-1 examples)", () => {
    const rule = rules.subroutines.general.find((r: { id: string }) => r.id === "SUB-1");
    expectNoErrors(rule.validExample);
    expectError(rule.invalidExample.replace("   // error: B is not defined yet", ""), /Move B above line 5/);
  });
  test("a local can have the same name as a global at AS Level", () => {
    const prog = src(
      "DECLARE Total : INTEGER", "PROCEDURE Show()", "\tDECLARE Total : INTEGER", "\tTotal ← 2", "\tOUTPUT Total", "ENDPROCEDURE",
      "Total ← 1", "CALL Show()", "OUTPUT Total",
    );
    assert.deepEqual(output(prog), ["2", "1"]);
  });
  test("layout: statements one tab in, ELSE lined up with IF", () => {
    expectError(src("DECLARE X : INTEGER", "X ← 5", "IF X > 3 THEN", "\tOUTPUT X", "\tELSE", "\tOUTPUT 0", "ENDIF"), /indented 0 tabs/, 5);
  });
});

describe("AS examples from the guide", () => {
  test("nested IF", () => {
    const prog = src(
      "DECLARE ChallengerScore : INTEGER", "DECLARE ChampionScore : INTEGER", "DECLARE HighestScore : INTEGER",
      "DECLARE ChallengerName : STRING", "DECLARE ChampionName : STRING",
      "INPUT ChallengerName", "INPUT ChallengerScore", "INPUT ChampionName", "INPUT ChampionScore", "INPUT HighestScore",
      rules.selection.if.example,
    );
    assert.deepEqual(output(prog, ["Ali", "90", "Sara", "80", "85"]), ["Ali is champion and highest scorer"]);
    assert.deepEqual(output(prog, ["Ali", "70", "Sara", "80", "75"]), ["Sara is still the champion", "Sara is also the highest scorer"]);
  });
  test("CASE", () => {
    const prog = src(
      "PROCEDURE Beep()", "\tOUTPUT \"Beep\"", "ENDPROCEDURE",
      // The guide writes CALL Beep, which breaks its own rule PROC-4 (brackets are required).
      "DECLARE Move : CHAR", "DECLARE Position : INTEGER", "Position ← 50", rules.selection.case.example.replace("CALL Beep", "CALL Beep()"), "OUTPUT Position",
    );
    assert.deepEqual(output(prog, ["S"]), ["60"]);
    assert.deepEqual(output(prog, ["X"]), ["Beep", "50"]);
  });
  test("loops", () => {
    assert.deepEqual(output(src("DECLARE Number : INTEGER", "Number ← 40", rules.iteration.while.example, "OUTPUT Number")), ["4"]);
    assert.deepEqual(output(src("DECLARE Password : STRING", rules.iteration.repeat.example), ["x", "Secret"]),
      ["Please enter the password", "Please enter the password"]);
  });
  test("function Max", () => {
    assert.deepEqual(output(src("DECLARE Distance : INTEGER", "Distance ← 7", rules.subroutines.function.example)), ["Penalty Fine = 14"]);
  });
  test("BYREF SWAP: the keyword carries on to the next parameter", () => {
    const prog = src(
      "PROCEDURE Swap(BYREF X : INTEGER, Y : INTEGER)", "\tDECLARE Temp : INTEGER", "\tTemp ← X", "\tX ← Y", "\tY ← Temp", "ENDPROCEDURE",
      "DECLARE A : INTEGER", "DECLARE B : INTEGER", "A ← 1", "B ← 2", "CALL Swap(A, B)", "OUTPUT A, \" \", B",
    );
    assert.deepEqual(output(prog), ["2 1"]);
  });
  test("BYVAL is the default", () => {
    const prog = src(
      "PROCEDURE AddOne(N : INTEGER)", "\tN ← N + 1", "ENDPROCEDURE",
      "PROCEDURE AddOneRef(BYREF N : INTEGER)", "\tN ← N + 1", "ENDPROCEDURE",
      "DECLARE X : INTEGER", "X ← 5", "CALL AddOne(X)", "OUTPUT X", "CALL AddOneRef(X)", "OUTPUT X",
    );
    assert.deepEqual(output(prog), ["5", "6"]);
  });
  test("BYREF works with array elements and record fields", () => {
    const prog = src(
      "TYPE Point", "\tDECLARE X : INTEGER", "\tDECLARE Y : INTEGER", "ENDTYPE",
      "PROCEDURE Double(BYREF N : INTEGER)", "\tN ← N * 2", "ENDPROCEDURE",
      "DECLARE List : ARRAY[1:3] OF INTEGER", "DECLARE P : Point",
      "List[2] ← 5", "P.Y ← 7", "CALL Double(List[2])", "CALL Double(P.Y)", "OUTPUT List[2], \" \", P.Y",
    );
    assert.deepEqual(output(prog), ["10 14"]);
  });
  test("text files with EOF and APPEND", () => {
    const prog = src(rules.fileHandling.text.example, "OPENFILE \"FileB.txt\" FOR APPEND", "WRITEFILE \"FileB.txt\", \"end\"", "CLOSEFILE \"FileB.txt\"");
    const r = run(prog, [], { "FileA.txt": "one\n\ntwo\n" });
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.files["FileB.txt"], "one\n-------------------------\ntwo\nend");
  });
  test("built-in functions (rules file examples)", () => {
    const strip = (v: string) => v.replace(/^["']|["']$/g, "");
    const fns = [...rules.builtInFunctions.string, ...rules.builtInFunctions.numeric, ...rules.builtInFunctions.date];
    for (const f of fns) {
      const examples = f.examples ?? (f.example ? [f.example] : []);
      for (const ex of examples) {
        if (ex.returns.startsWith("e.g.")) continue;
        assert.deepEqual(output(`OUTPUT ${ex.call}`), [strip(ex.returns)], ex.call);
      }
    }
  });
  test("logical operators (insert examples)", () => {
    for (const ex of rules.operators.logical.examples) {
      assert.deepEqual(output(`OUTPUT ${ex.expression}`), [ex.result], ex.expression);
    }
  });
  test("string comparisons are case-sensitive; CHAR and STRING compare", () => {
    assert.deepEqual(output("OUTPUT \"Program\" = \"program\", \" \", 'a' = \"a\", \" \", \"a\" = \"a \""), ["FALSE TRUE FALSE"]);
  });
});

describe("records, arrays and dates", () => {
  const recordType = rules.userDefinedTypes.record.examples[0];

  test("the StudentRecord example", () => {
    const prog = src(
      recordType,
      "DECLARE Pupil1 : StudentRecord", "DECLARE Pupil2 : StudentRecord",
      "Pupil1.LastName ← \"Johnson\"", "Pupil1.FirstName ← \"Leroy\"",
      "Pupil1.DateOfBirth ← 02/01/2005", "Pupil1.YearGroup ← 6", "Pupil1.FormGroup ← 'A'",
      "Pupil2 ← Pupil1", "Pupil2.FirstName ← \"Mary\"",
      "OUTPUT Pupil1.FirstName, \" \", Pupil2.FirstName, \" \", Pupil2.LastName, \" \", Pupil2.DateOfBirth",
    );
    assert.deepEqual(output(prog), ["Leroy Mary Johnson 02/01/2005"]);
  });
  test("an array of records", () => {
    const prog = src(
      recordType, "DECLARE Form : ARRAY[1:30] OF StudentRecord", "DECLARE Index : INTEGER",
      "FOR Index ← 1 TO 30", "\tForm[Index].YearGroup ← Index MOD 3", "NEXT Index", "OUTPUT Form[5].YearGroup",
    );
    assert.deepEqual(output(prog), ["2"]);
  });
  test("record mistakes", () => {
    expectError(src(recordType, "DECLARE P : StudentRecord", "P.Age ← 5"), /no field called Age/);
    expectError(src(recordType, "DECLARE P : StudentRecord", "OUTPUT P"), /is a record/);
    expectError(src(recordType, "DECLARE P : StudentRecord", "DECLARE Q : StudentRecord", "OUTPUT P = Q"), /is a record/);
    expectError(src("DECLARE P : Student"), /no type called Student/);
  });
  test("whole arrays can be copied when they match", () => {
    const prog = src(
      "DECLARE A : ARRAY[1:3] OF INTEGER", "DECLARE B : ARRAY[1:3] OF INTEGER",
      "A[1] ← 9", "B ← A", "A[1] ← 1", "OUTPUT B[1]",
    );
    assert.deepEqual(output(prog), ["9"]);
    expectError(src("DECLARE A : ARRAY[1:3] OF INTEGER", "DECLARE B : ARRAY[1:4] OF INTEGER", "B ← A"), /size and element type match/);
  });
  test("dates", () => {
    const prog = src(
      "DECLARE D : DATE", "D ← SETDATE(25, 12, 2024)",
      "OUTPUT D, \" \", DAY(D), \"/\", MONTH(D), \"/\", YEAR(D), \" \", DAYINDEX(D), \" \", D > 01/01/2024",
    );
    assert.deepEqual(output(prog), ["25/12/2024 25/12/2024 4 TRUE"]);
    assert.deepEqual(output(src("DECLARE D : DATE", "INPUT D", "OUTPUT D"), ["3/7/2021"]), ["03/07/2021"]);
    expectError("OUTPUT DAY(31/02/2023)", /isn't a real date/);
    runtimeError(src("DECLARE D : DATE", "D ← SETDATE(31, 2, 2023)"), /isn't a real date/);
  });
});

describe("AS type rules", () => {
  test("a STRING of length 1 can be stored in a CHAR", () => {
    assert.deepEqual(output(src("DECLARE C : CHAR", "C ← \"A\"", "OUTPUT C")), ["A"]);
    expectError(src("DECLARE C : CHAR", "C ← \"AB\""), /only store one character/);
    runtimeError(src("DECLARE C : CHAR", "DECLARE S : STRING", "S ← \"AB\"", "C ← S"), /CHAR holds exactly one character/);
  });
  test("STR_TO_NUM into an INTEGER works for whole numbers", () => {
    assert.deepEqual(output(src("DECLARE N : INTEGER", "N ← STR_TO_NUM(\"42\")", "OUTPUT N + 1")), ["43"]);
    runtimeError(src("DECLARE N : INTEGER", "N ← STR_TO_NUM(\"4.5\")"), /isn't a whole number/);
    runtimeError(src("DECLARE N : REAL", "N ← STR_TO_NUM(\"abc\")"), /can't turn "abc" into a number/);
  });
  test("BYREF rules", () => {
    expectError(src("PROCEDURE P(BYREF N : INTEGER)", "\tN ← 1", "ENDPROCEDURE", "CALL P(5)"), /needs a variable/);
    expectError(src("PROCEDURE P(BYREF N : REAL)", "\tN ← 1", "ENDPROCEDURE", "DECLARE X : INTEGER", "CALL P(X)"), /exactly that type/);
    expectError(src("FUNCTION F(BYREF N : INTEGER) RETURNS INTEGER", "\tRETURN N", "ENDFUNCTION"), /FUNCTION can't have BYREF/);
  });
  test("files hold text", () => {
    expectError(src("DECLARE N : INTEGER", "OPENFILE \"a.txt\" FOR READ", "READFILE \"a.txt\", N"), /needs a STRING variable/);
    expectError(src("OPENFILE \"a.txt\" FOR WRITE", "WRITEFILE \"a.txt\", 5"), /NUM_TO_STR/);
  });
  test("LCASE / UCASE take a CHAR", () => {
    expectError(src("DECLARE S : STRING", "S ← \"abc\"", "OUTPUT UCASE(S)"), /TO_UPPER/);
    assert.deepEqual(output("OUTPUT UCASE('h'), LCASE('W'), UCASE('1')"), ["Hw1"]);
  });
});

describe("AS runtime errors", () => {
  test("string functions out of range", () => {
    runtimeError("OUTPUT MID(\"ABC\", 2, 5)", /only has 3 characters/);
    runtimeError("OUTPUT LEFT(\"ABC\", 4)", /only has 3 characters/);
    runtimeError("OUTPUT CHR(200)", /0 to 127/);
  });
  test("EOF on a file that isn't open", () => {
    runtimeError("OUTPUT EOF(\"a.txt\")", /open FOR READ/);
  });
  test("reading past the end suggests EOF", () => {
    runtimeError(src("DECLARE S : STRING", "OPENFILE \"a.txt\" FOR READ", "READFILE \"a.txt\", S", "READFILE \"a.txt\", S"), /Check EOF/, [], { "a.txt": "one" });
  });
  test("RAND is between 0 and x", () => {
    const r = runSource(src("DECLARE N : REAL", "N ← RAND(10)", "OUTPUT (N >= 0) AND (N < 10)"), { level: "AS" });
    assert.deepEqual(r.output, ["TRUE"]);
  });
  test("an unassigned record field gives a warning", () => {
    const r = run(src("TYPE Point", "\tDECLARE X : INTEGER", "ENDTYPE", "DECLARE P : Point", "OUTPUT P.X"));
    assert.match(r.runtimeWarnings[0]?.message ?? "", /P\.X was used before it was given a value/);
  });
});

describe("the page's AS example programs", () => {
  test("all compile with no errors or warnings", async () => {
    const examplesPath = "../../../client/src/examples.js"; // plain JS, so no types
    const { EXAMPLES } = await import(examplesPath);
    for (const ex of EXAMPLES.AS as { title: string; code: string }[]) {
      const ds = compile(ex.code, "AS").diagnostics;
      assert.equal(ds.length, 0, `${ex.title}:\n${ds.map((d) => `  L${d.line}: ${d.message}`).join("\n")}`);
    }
  });
});

test("O Level is unchanged: AS-only syntax is still rejected there", () => {
  const o = compile(src("DECLARE S : STRING", "S ← \"a\" & \"b\""), "O").diagnostics;
  assert.ok(o.some((d) => /& is A Level only/.test(d.message)));
});
