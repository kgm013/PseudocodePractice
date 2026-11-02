// Step 2: indentation check. One tab per level.

import type { Diagnostics } from "./diagnostics.ts";
import type { SourceLine } from "./lexer.ts";
import type { Program, Stmt } from "./ast.ts";

const tabs = (n: number) => `${n} tab${n === 1 ? "" : "s"}`;

export function checkLayout(program: Program, lines: SourceLine[], diags: Diagnostics): void {
  const isAS = program.level === "AS";
  const byLine = new Map(lines.map((l) => [l.line, l]));
  const reported = new Set<number>();

  const expect = (line: number | undefined, depth: number) => {
    if (line === undefined || reported.has(line)) return;
    const sl = byLine.get(line);
    if (!sl || !sl.indentOk || sl.lexError) return;
    if (sl.depth !== depth) {
      reported.add(line);
      diags.error(
        `This line should be indented ${tabs(depth)}, but it has ${tabs(sl.depth)}.`,
        line, 1, Math.max(2, sl.depth + 1),
      );
    }
  };

  const block = (stmts: Stmt[], d: number) => {
    for (const s of stmts) stmt(s, d);
  };

  // A statement at depth d. Statements written after a case label (or after
  // ELSE) are "inline": their line has already been checked.
  const stmt = (s: Stmt, d: number) => {
    if (!s.inline) expect(s.line, d);
    // A block that never closed has probably swallowed lines that belong
    // elsewhere; its "missing END…" error is enough.
    if (("body" in s || s.k === "if" || s.k === "typedef") && s.endLine === undefined) return;
    switch (s.k) {
      case "if":
        if (isAS) {
          // IF … THEN / statements one tab in / ELSE / statements / ENDIF
          block(s.thenBody, d + 1);
          expect(s.elseLine, d);
          if (s.elseBody) block(s.elseBody, d + 1);
        } else {
          // IF / THEN one tab in / statements two tabs in / ELSE one tab in / ENDIF
          expect(s.thenLine, d + 1);
          block(s.thenBody, d + 2);
          expect(s.elseLine, d + 1);
          if (s.elseBody) block(s.elseBody, d + 2);
        }
        expect(s.endLine, d);
        break;
      case "case":
        for (const c of s.clauses) {
          expect(c.line, d + 1);
          clauseBody(c.body, d);
        }
        if (s.otherwise) {
          expect(s.otherwise.line, d + 1);
          clauseBody(s.otherwise.body, d);
        }
        expect(s.endLine, d);
        break;
      case "for": case "while": case "repeat": case "procedure": case "function":
        block(s.body, d + 1);
        expect(s.endLine, d);
        break;
      case "typedef":
        for (const f of s.fields) expect(f.line, d + 1);
        expect(s.endLine, d);
        break;
    }
  };

  const clauseBody = (body: Stmt[], d: number) => {
    for (const s of body) stmt(s, s.inline ? d + 1 : d + 2);
  };

  block(program.body, 0);

  // Comment-only lines: a warning if not lined up with the code below.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.hasComment || l.tokens.length > 0 || !l.indentOk) continue;
    const nextCode = lines.slice(i + 1).find((x) => x.tokens.length > 0);
    if (!nextCode || !nextCode.indentOk) continue;
    if (nextCode.depth !== l.depth) {
      diags.warning(
        `Indent this comment like the code below it (${tabs(nextCode.depth)}).`,
        l.line, 1, Math.max(2, l.depth + 1),
      );
    }
  }
}
