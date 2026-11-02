// Step 3a: build the program tree from the tokens.

import type { Diagnostics } from "./diagnostics.ts";
import type { SourceLine, Token } from "./lexer.ts";
import type { LevelSpec } from "./levels.ts";
import { parseDate } from "./dates.ts";
import type {
  BasicTypeName, BoundNode, CaseClause, CaseLabel, CaseStmt, DimNode, Expr, FieldDecl, FileName, ForStmt,
  FunctionDef, IfStmt, LitExpr, Param, PlaceExpr, Pos, ProcedureDef, Program, Stmt, Target, TypeDef, TypeNode,
} from "./ast.ts";

const CLOSERS = new Set([
  "THEN", "ELSE", "ENDIF", "OTHERWISE", "ENDCASE", "NEXT", "UNTIL", "ENDWHILE", "ENDPROCEDURE", "ENDFUNCTION", "ENDTYPE",
]);

const OPENER_OF: Record<string, string> = {
  THEN: "IF", ELSE: "IF", ENDIF: "IF", OTHERWISE: "CASE OF", ENDCASE: "CASE OF", NEXT: "FOR",
  UNTIL: "REPEAT", ENDWHILE: "WHILE", ENDPROCEDURE: "PROCEDURE", ENDFUNCTION: "FUNCTION", ENDTYPE: "TYPE",
};

const TYPE_HINTS: Record<string, string> = {
  INT: "INTEGER", FLOAT: "REAL", DOUBLE: "REAL", DECIMAL: "REAL", NUMBER: "INTEGER or REAL",
  BOOL: "BOOLEAN", STR: "STRING", TEXT: "STRING", CHARACTER: "CHAR",
};

const O_PREC: Record<string, number> = {
  OR: 1, AND: 2,
  "=": 4, "<>": 4, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "^": 8,
};
const O_NEG_PREC = 7;

const AS_PREC: Record<string, number> = {
  OR: 1, AND: 2,
  "=": 4, "<>": 4, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "&": 5, "+": 6, "-": 6, "*": 7, "/": 7, DIV: 7, MOD: 7,
};
const AS_NEG_PREC = 8;

class ParseError {
  message: string;
  line: number;
  col?: number;
  endCol?: number;
  constructor(message: string, line: number, col?: number, endCol?: number) {
    this.message = message;
    this.line = line;
    this.col = col;
    this.endCol = endCol;
  }
}

interface Ctx {
  /** Directly at the top level of the program (not inside any block). */
  top: boolean;
  sub: "procedure" | "function" | null;
  /** The body of a CASE clause: stops at the next case label. */
  caseBody: boolean;
}

const posOf = (t: Token): Pos => ({ line: t.line, col: t.col, endCol: t.endCol });
const span = (a: Pos, b: Pos): Pos => ({ line: a.line, col: a.col, endCol: b.endCol });

export function parse(lines: SourceLine[], diags: Diagnostics, spec: LevelSpec): Program {
  return new Parser(lines, diags, spec).parseProgram();
}

class Parser {
  private code: SourceLine[];
  private li = 0;
  private ti = 0;
  private diags: Diagnostics;
  private spec: LevelSpec;
  private isAS: boolean;
  private prec: Record<string, number>;
  private negPrec: number;
  private lexErrorLines: Set<number>;
  private lineText: Map<number, string>;
  private reportedCase = new Set<Token>();
  /** Closing keywords that an enclosing construct is waiting for. */
  private expectedClosers: Set<string>[] = [];
  private caseDepth = 0;

  constructor(lines: SourceLine[], diags: Diagnostics, spec: LevelSpec) {
    this.code = lines.filter((l) => l.tokens.length > 0);
    this.diags = diags;
    this.spec = spec;
    this.isAS = spec.level === "AS";
    this.prec = this.isAS ? AS_PREC : O_PREC;
    this.negPrec = this.isAS ? AS_NEG_PREC : O_NEG_PREC;
    this.lexErrorLines = new Set(lines.filter((l) => l.lexError).map((l) => l.line));
    this.lineText = new Map(lines.map((l) => [l.line, l.text]));
  }

  // ---- token helpers ------------------------------------------------------

  private get cur(): SourceLine | undefined {
    return this.code[this.li];
  }
  private peek(offset = 0): Token | undefined {
    return this.cur?.tokens[this.ti + offset];
  }
  private next(): Token {
    const t = this.peek();
    if (!t) throw this.errAt(undefined, "This line ends too early.");
    this.ti++;
    return t;
  }
  private atEol(): boolean {
    return this.peek() === undefined;
  }
  private nextLine(): void {
    this.li++;
    this.ti = 0;
  }
  private isKw(t: Token | undefined, kw: string): t is Token & { kind: "keyword" } {
    return !!t && t.kind === "keyword" && t.value === kw;
  }
  private isOp(t: Token | undefined, op: string): t is Token & { kind: "op" } {
    return !!t && t.kind === "op" && t.value === op;
  }
  private isBasicType(t: Token | undefined): t is Token & { kind: "keyword" } {
    return !!t && t.kind === "keyword" && this.spec.basicTypes.has(t.value);
  }

  private report(message: string, line: number, col?: number, endCol?: number): void {
    if (this.lexErrorLines.has(line)) return;
    this.diags.error(message, line, col, endCol);
  }
  private reportAt(t: Token, message: string): void {
    this.report(message, t.line, t.col, t.endCol);
  }
  private reportErr(e: unknown): void {
    if (!(e instanceof ParseError)) throw e;
    this.report(e.message, e.line, e.col, e.endCol);
  }
  private errAt(t: Token | undefined, message: string): ParseError {
    if (t) return new ParseError(message, t.line, t.col, t.endCol);
    const line = this.cur ?? this.code[this.code.length - 1];
    const len = line ? line.text.length : 0;
    return new ParseError(message, line ? line.line : 1, Math.max(1, len), len + 1);
  }

  private checkCase(t: Token): void {
    if (t.badCase && !this.reportedCase.has(t)) {
      this.reportedCase.add(t);
      this.reportAt(t, `Keywords must be written in capitals: ${t.value}, not ${t.text}.`);
    }
  }
  private acceptKw(kw: string): Token | null {
    const t = this.peek();
    if (this.isKw(t, kw)) {
      this.checkCase(t);
      this.ti++;
      return t;
    }
    return null;
  }
  private expectKw(kw: string, message: string): Token {
    const t = this.acceptKw(kw);
    if (!t) throw this.errAt(this.peek(), message);
    return t;
  }
  private acceptOp(op: string): Token | null {
    const t = this.peek();
    if (this.isOp(t, op)) {
      this.ti++;
      return t;
    }
    return null;
  }
  private expectOp(op: string, message: string): Token {
    const t = this.acceptOp(op);
    if (!t) throw this.errAt(this.peek(), message);
    return t;
  }
  private expectEol(message?: string): void {
    const t = this.peek();
    if (t) throw this.errAt(t, message ?? `Unexpected "${t.text}" here. Each statement goes on its own line.`);
  }
  private keywordAsName(t: Token): string {
    const kind = t.value in this.spec.builtins ? "the name of a built-in function" : "a keyword";
    return `"${t.text}" can't be used as a name, because ${t.value} is ${kind}.`;
  }
  private expectIdent(message: string): Token {
    const t = this.peek();
    if (t && t.kind === "ident") {
      this.ti++;
      return t;
    }
    if (t && t.kind === "keyword") throw this.errAt(t, this.keywordAsName(t));
    throw this.errAt(t, message);
  }
  /** A DO after a WHILE or FOR line. */
  private isDo(t: Token | undefined): boolean {
    return !!t && (this.isKw(t, "DO") || (t.kind === "ident" && t.text.toUpperCase() === "DO"));
  }

  // ---- program and blocks ---------------------------------------------------

  parseProgram(): Program {
    const body = this.parseBlock({ top: true, sub: null, caseBody: false });
    return { level: this.spec.level, body };
  }

  private isExpected(kw: string): boolean {
    return this.expectedClosers.some((s) => s.has(kw));
  }

  private startsCaseLabel(line: SourceLine): boolean {
    const t = line.tokens[0];
    if (["int", "real", "char", "string", "date"].includes(t.kind)) return true;
    if (this.isKw(t, "TRUE") || this.isKw(t, "FALSE")) return true;
    const t2 = line.tokens[1];
    return this.isOp(t, "-") && !!t2 && (t2.kind === "int" || t2.kind === "real");
  }

  private parseBlock(ctx: Ctx): Stmt[] {
    const out: Stmt[] = [];
    while (this.cur) {
      const first = this.cur.tokens[0];
      if (first.kind === "keyword" && CLOSERS.has(first.value)) {
        if (this.isExpected(first.value)) break;
        this.checkCase(first);
        this.reportAt(first, `${first.value} has no matching ${OPENER_OF[first.value]}.`);
        this.nextLine();
        continue;
      }
      if (this.caseDepth > 0 && this.startsCaseLabel(this.cur)) break;
      if (ctx.sub && (this.isKw(first, "PROCEDURE") || this.isKw(first, "FUNCTION") || this.isKw(first, "TYPE"))) break;
      const s = this.parseStatementSafe(ctx);
      if (s) out.push(s);
    }
    return out;
  }

  private withClosers<T>(closers: string[], fn: () => T): T {
    this.expectedClosers.push(new Set(closers));
    try {
      return fn();
    } finally {
      this.expectedClosers.pop();
    }
  }

  private child(ctx: Ctx): Ctx {
    return { top: false, sub: ctx.sub, caseBody: false };
  }

  /** Report a missing or wrong closing keyword. Consumes the line if it matches. */
  private closeWith(endKw: string, opener: string, openLine: number): number | undefined {
    const l = this.cur;
    if (l && this.isKw(l.tokens[0], endKw)) {
      this.checkCase(l.tokens[0]);
      this.ti = 1;
      if (!this.atEol()) this.reportAt(this.peek()!, `Nothing else can go on the ${endKw} line.`);
      this.nextLine();
      return l.line;
    }
    if (l) {
      const f = l.tokens[0];
      this.report(`The ${opener} on line ${openLine} needs a matching ${endKw}, but line ${l.line} has "${f.text}" first.`, openLine);
    } else {
      this.report(`The ${opener} on line ${openLine} has no matching ${endKw}.`, openLine);
    }
    return undefined;
  }

  // ---- statements ---------------------------------------------------------

  private parseStatementSafe(ctx: Ctx): Stmt | null {
    const startLi = this.li;
    try {
      return this.parseStatement(ctx);
    } catch (e) {
      this.reportErr(e);
      if (this.li === startLi) this.nextLine();
      return null;
    }
  }

  private parseStatement(ctx: Ctx): Stmt {
    const t = this.peek()!;
    const inline = this.ti > 0;
    let s: Stmt;
    if (t.kind === "keyword") {
      switch (t.value) {
        case "DECLARE": s = this.parseDeclare(); break;
        case "CONSTANT": s = this.parseConstant(); break;
        case "INPUT": s = this.parseInput(); break;
        case "OUTPUT": s = this.parseOutput(); break;
        case "IF": s = this.parseIf(ctx); break;
        case "CASE": s = this.parseCase(ctx); break;
        case "FOR": s = this.parseFor(ctx); break;
        case "REPEAT": s = this.parseRepeat(ctx); break;
        case "WHILE": s = this.parseWhile(ctx); break;
        case "CALL": s = this.parseCall(); break;
        case "RETURN": s = this.parseReturn(ctx); break;
        case "OPENFILE": s = this.parseOpenFile(); break;
        case "READFILE": s = this.parseReadFile(); break;
        case "WRITEFILE": s = this.parseWriteFile(); break;
        case "CLOSEFILE": s = this.parseCloseFile(); break;
        case "PROCEDURE": s = this.parseSub(ctx, false); break;
        case "FUNCTION": s = this.parseSub(ctx, true); break;
        case "TYPE":
          if (this.isAS) { s = this.parseTypeDef(ctx); break; }
          throw this.errAt(t, `A statement can't start with ${t.value}.`);
        default:
          if (t.value in this.spec.builtins) {
            throw this.errAt(t, `${t.value} gives back a value, so it can't be a statement on its own. Use it in an assignment or OUTPUT, for example Result ← ${this.spec.builtins[t.value].usage}.`);
          }
          throw this.errAt(t, `A statement can't start with ${t.value}.`);
      }
    } else if (t.kind === "ident") {
      s = this.parseAssignment();
    } else if (t.kind === "op") {
      throw this.errAt(t, `A statement can't start with "${t.text}".`);
    } else {
      throw this.errAt(t, "A statement can't start with a value. (Case values such as 1 : … only go inside CASE OF.)");
    }
    if (inline) s.inline = true;
    return s;
  }

  private parseDeclare(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const name = this.expectIdent("DECLARE needs a name and a type, for example DECLARE Total : INTEGER.");
    if (this.isOp(this.peek(), ",")) {
      throw this.errAt(this.peek(), "Declare one variable per DECLARE, for example DECLARE Total : INTEGER.");
    }
    if (this.isOp(this.peek(), "←")) {
      throw this.errAt(this.peek(), "You can't give a value in a DECLARE. Declare the variable, then assign a value on the next line.");
    }
    this.expectOp(":", `Put a colon between the name and the type: DECLARE ${name.text} : INTEGER.`);
    const typeNode = this.parseType();
    this.expectEol();
    this.nextLine();
    return { k: "declare", line: kw.line, name: name.text, namePos: posOf(name), typeNode };
  }

  private typeList(): string {
    return this.isAS ? "INTEGER, REAL, CHAR, STRING, BOOLEAN, DATE or a TYPE you defined" : "INTEGER, REAL, CHAR, STRING or BOOLEAN";
  }

  /** A type that isn't an array: a basic type, or (AS) the name of a record type. */
  private parseSimpleType(): TypeNode {
    const t = this.peek();
    if (this.isBasicType(t)) {
      this.checkCase(t);
      this.ti++;
      return { k: "basic", name: t.value as BasicTypeName, pos: posOf(t) };
    }
    if (t && t.kind === "ident") {
      const hint = TYPE_HINTS[t.text.toUpperCase()];
      if (this.isAS && !hint) {
        this.ti++;
        return { k: "named", name: t.text, pos: posOf(t) };
      }
      throw this.errAt(t, `${t.text} isn't a data type. ${hint ? `Use ${hint}.` : `Use ${this.typeList()}.`}`);
    }
    throw this.errAt(t, `Expected a data type: ${this.typeList()}.`);
  }

  private parseType(): TypeNode {
    const t = this.peek();
    if (this.isKw(t, "ARRAY")) {
      this.checkCase(t);
      this.ti++;
      this.expectOp("[", "Write the array's bounds in square brackets, for example ARRAY[1:10] OF INTEGER.");
      const dims: DimNode[] = [this.parseDim()];
      while (this.acceptOp(",")) dims.push(this.parseDim());
      if (dims.length > 2) throw this.errAt(t, "Arrays can have at most 2 dimensions.");
      this.expectOp("]", "Close the bounds with ], for example ARRAY[1:10] OF INTEGER.");
      this.expectKw("OF", "Say what the array holds, for example ARRAY[1:10] OF INTEGER.");
      if (this.isKw(this.peek(), "ARRAY")) throw this.errAt(this.peek(), "For a 2D array, give both bounds in one pair of brackets: ARRAY[1:3, 1:3] OF INTEGER.");
      const elem = this.parseSimpleType();
      return { k: "array", dims, elem, pos: span(posOf(t), elem.pos) };
    }
    return this.parseSimpleType();
  }

  private parseDim(): DimNode {
    const lo = this.parseBound();
    if (!this.acceptOp(":")) throw this.errAt(this.peek(), "Give both bounds with a colon between them, for example ARRAY[1:10].");
    const hi = this.parseBound();
    return { lo, hi };
  }

  private parseBound(): BoundNode {
    const t = this.peek();
    if (this.isOp(t, "-") && this.peek(1)?.kind === "int") {
      this.ti++;
      const n = this.next();
      return { k: "num", value: -Number(n.value), pos: span(posOf(t), posOf(n)) };
    }
    if (t && t.kind === "int") {
      this.ti++;
      return { k: "num", value: Number(t.value), pos: posOf(t) };
    }
    if (t && t.kind === "ident") {
      this.ti++;
      return { k: "name", name: t.text, pos: posOf(t) };
    }
    throw this.errAt(t, "An array bound must be a whole number or an INTEGER constant.");
  }

  private parseLiteralValue(message: string): LitExpr {
    const t = this.peek();
    if (this.isOp(t, "-")) {
      const n = this.peek(1);
      if (n && (n.kind === "int" || n.kind === "real")) {
        this.ti += 2;
        const lit = this.literalFrom(n);
        lit.value = -(lit.value as number);
        lit.pos = span(posOf(t), posOf(n));
        return lit;
      }
    }
    if (t && (t.kind === "int" || t.kind === "real" || t.kind === "char" || t.kind === "string" || t.kind === "date")) {
      this.ti++;
      return this.literalFrom(t);
    }
    if (this.isKw(t, "TRUE") || this.isKw(t, "FALSE")) {
      this.checkCase(t);
      this.ti++;
      return this.literalFrom(t);
    }
    throw this.errAt(t, message);
  }

  private literalFrom(t: Token): LitExpr {
    const pos = posOf(t);
    switch (t.kind) {
      case "int": {
        const value = Number(t.value);
        if (!Number.isSafeInteger(value)) throw this.errAt(t, "This whole number is too big.");
        return { k: "lit", litType: "INTEGER", value, pos };
      }
      case "real": return { k: "lit", litType: "REAL", value: Number(t.value), pos };
      case "char": return { k: "lit", litType: "CHAR", value: t.value, pos };
      case "string": return { k: "lit", litType: "STRING", value: t.value, pos };
      case "date": return { k: "lit", litType: "DATE", value: parseDate(t.value) ?? 0, pos };
      default: return { k: "lit", litType: "BOOLEAN", value: t.value === "TRUE", pos };
    }
  }

  private parseConstant(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const arrow = this.isAS ? "=" : "←";
    const name = this.expectIdent(`CONSTANT needs a name and a value, for example CONSTANT Rate ${arrow} 6.50.`);
    const t = this.peek();
    const wrong = this.isAS ? "←" : "=";
    if (this.isOp(t, wrong)) {
      this.reportAt(t, `${this.spec.name} constants use ${arrow}, not ${wrong}: CONSTANT Rate ${arrow} 6.50.`);
      this.ti++;
    } else if (this.isOp(t, ":")) {
      throw this.errAt(t, `Constants don't have a type. Write CONSTANT Rate ${arrow} 6.50.`);
    } else {
      this.expectOp(arrow, `Give the constant a value with ${arrow}, for example CONSTANT Rate ${arrow} 6.50.`);
    }
    const message = "A constant's value must be written directly, such as 10, 6.50, 'Y' or \"N/A\". It can't be a calculation or another name.";
    const value = this.parseLiteralValue(message);
    this.expectEol(message);
    this.nextLine();
    return { k: "constant", line: kw.line, name: name.text, namePos: posOf(name), value };
  }

  /** A variable, array element or (AS) record field that a value can be stored in. */
  private parsePlace(message: string): PlaceExpr {
    const name = this.expectIdent(message);
    return this.parsePostfix({ k: "name", name: name.text, pos: posOf(name) }) as PlaceExpr;
  }

  private parseTarget(message: string): Target {
    const place = this.parsePlace(message);
    return { place, pos: place.pos };
  }

  private parseAssignment(): Stmt {
    const first = this.peek()!;
    const name = this.expectIdent("Expected a variable name.");
    if (this.isOp(this.peek(), "(")) {
      throw this.errAt(first, `To run a procedure, write CALL ${name.text}(…). To use a function, put it in an assignment or OUTPUT.`);
    }
    const place = this.parsePostfix({ k: "name", name: name.text, pos: posOf(name) }) as PlaceExpr;
    const target: Target = { place, pos: place.pos };
    const after = this.peek();
    if (this.isOp(after, "=")) {
      throw this.errAt(after, "Use ← to assign a value (you can type <-). = is only for comparing.");
    }
    if (!after) {
      throw this.errAt(first, `"${name.text}" on its own isn't a statement. To run a procedure, write CALL ${name.text}${this.isAS ? "()" : ""}.`);
    }
    this.expectOp("←", `Expected ← after ${name.text} (you can type <-).`);
    const value = this.parseExpr();
    this.expectEol();
    this.nextLine();
    return { k: "assign", line: first.line, target, value };
  }

  private parseInput(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const t = this.peek();
    if (t && (t.kind === "string" || t.kind === "char")) {
      throw this.errAt(t, 'INPUT only takes a variable. To show a prompt, OUTPUT it first: OUTPUT "Enter your age" then INPUT Age.');
    }
    const target = this.parseTarget("INPUT needs a variable to store the value in, for example INPUT Age.");
    this.expectEol("INPUT takes one variable. Use a separate INPUT for each value.");
    this.nextLine();
    return { k: "input", line: kw.line, target };
  }

  private parseOutput(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    if (this.atEol()) throw this.errAt(kw, "OUTPUT needs something to output, for example OUTPUT \"Hello\".");
    const values = [this.parseExpr()];
    while (this.acceptOp(",")) values.push(this.parseExpr());
    this.expectEol();
    this.nextLine();
    return { k: "output", line: kw.line, values };
  }

  private parseIf(ctx: Ctx): IfStmt {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    const node: IfStmt = { k: "if", line, cond: null, thenBody: [], elseBody: null };
    let sawThen = false;
    try {
      if (this.atEol()) throw this.errAt(kw, `IF needs a condition, for example IF Score > 50${this.isAS ? " THEN" : ""}.`);
      node.cond = this.parseExpr();
      const t = this.peek();
      if (this.isKw(t, "THEN")) {
        this.checkCase(t);
        if (!this.isAS) this.reportAt(t, "At O Level / IGCSE, THEN goes on its own line, one tab in from IF.");
        this.ti++;
        sawThen = true;
        if (this.isAS && !this.atEol()) {
          throw this.errAt(this.peek(), "Put the statements after THEN on the following lines, not on the IF line.");
        }
      }
      this.expectEol();
    } catch (e) {
      this.reportErr(e);
    }
    this.nextLine();

    return this.withClosers(["THEN", "ELSE", "ENDIF"], () => {
      const l = this.cur;
      if (l && this.isKw(l.tokens[0], "THEN")) {
        this.checkCase(l.tokens[0]);
        if (this.isAS) this.reportAt(l.tokens[0], "At AS Level, THEN goes at the end of the IF line: IF … THEN.");
        node.thenLine = l.line;
        this.ti = 1;
        if (!this.atEol()) this.reportAt(this.peek()!, "Put the statements under THEN on the following lines, not on the THEN line.");
        this.nextLine();
      } else if (!sawThen) {
        this.report(this.isAS
          ? "IF needs THEN at the end of the line, for example IF Score > 50 THEN."
          : "IF needs THEN on the next line, one tab in from IF.", line);
      }
      node.thenBody = this.parseBlock(this.child(ctx));
      const e = this.cur;
      if (e && this.isKw(e.tokens[0], "ELSE")) {
        this.checkCase(e.tokens[0]);
        node.elseLine = e.line;
        this.ti = 1;
        const t = this.peek();
        node.elseBody = [];
        if (this.isKw(t, "IF")) {
          this.reportAt(t, `There is no ELSE IF${this.isAS ? "" : " at O Level / IGCSE"}. Put the IF on its own line under ELSE, with its own ENDIF.`);
          const nested = this.parseStatementSafe(this.child(ctx));
          if (nested) node.elseBody.push(nested);
        } else {
          if (t) this.reportAt(t, "Put the statements under ELSE on the following lines, not on the ELSE line.");
          this.nextLine();
        }
        node.elseBody.push(...this.parseBlock(this.child(ctx)));
      }
      node.endLine = this.closeWith("ENDIF", "IF", line);
      return node;
    });
  }

  private parseCase(ctx: Ctx): CaseStmt {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    const node: CaseStmt = { k: "case", line, subject: null, clauses: [], otherwise: null };
    try {
      if (!this.acceptKw("OF")) throw this.errAt(this.peek() ?? kw, "Write CASE OF followed by a variable, for example CASE OF Choice.");
      const t = this.peek();
      if (!t || t.kind !== "ident") {
        throw this.errAt(t, t?.kind === "keyword" ? this.keywordAsName(t) : "CASE OF needs a variable name, for example CASE OF Choice.");
      }
      this.ti++;
      node.subject = { k: "name", name: t.text, pos: posOf(t) };
      if (!this.atEol()) {
        throw this.errAt(this.peek(), "After CASE OF, write just a variable name (not an array element or a calculation). Store the value in a variable first.");
      }
    } catch (e) {
      this.reportErr(e);
    }
    this.nextLine();

    const bodyCtx: Ctx = { top: false, sub: ctx.sub, caseBody: true };
    this.caseDepth++;
    try {
      return this.withClosers(["OTHERWISE", "ENDCASE"], () => {
        for (;;) {
          const l = this.cur;
          if (!l) break;
          const first = l.tokens[0];
          if (this.isKw(first, "ENDCASE")) break;
          if (this.isKw(first, "OTHERWISE")) {
            this.checkCase(first);
            if (node.otherwise) this.reportAt(first, "A CASE can only have one OTHERWISE.");
            this.ti = 1;
            if (!this.acceptOp(":") && this.isAS && !this.atEol()) {
              this.reportAt(first, "At AS Level, put a colon after OTHERWISE: OTHERWISE : OUTPUT \"Invalid\".");
            }
            const body: Stmt[] = [];
            if (this.atEol()) {
              this.report(`Put a statement on the OTHERWISE line, for example OTHERWISE ${this.isAS ? ": " : ""}OUTPUT "Invalid".`, l.line);
              this.nextLine();
            } else {
              const s = this.parseStatementSafe(this.child(ctx));
              if (s) body.push(s);
            }
            body.push(...this.parseBlock(bodyCtx));
            node.otherwise = { line: l.line, body };
            continue;
          }
          if (this.startsCaseLabel(l)) {
            if (node.otherwise) this.report("OTHERWISE must be the last case, after all the values.", l.line);
            const clause: CaseClause = { line: l.line, label: null, body: [] };
            try {
              clause.label = this.parseCaseLabel();
              this.expectOp(":", "Put a colon after the case value, for example 'A' : OUTPUT \"Apple\".");
              if (this.atEol()) throw this.errAt(undefined, "Put the first statement on the same line as the case value, after the colon.");
            } catch (e) {
              this.reportErr(e);
              this.nextLine();
              clause.body = this.parseBlock(bodyCtx);
              node.clauses.push(clause);
              continue;
            }
            const s = this.parseStatementSafe(this.child(ctx));
            if (s) clause.body.push(s);
            clause.body.push(...this.parseBlock(bodyCtx));
            node.clauses.push(clause);
            continue;
          }
          if (first.kind === "keyword" && CLOSERS.has(first.value)) break;
          if (ctx.sub && (this.isKw(first, "PROCEDURE") || this.isKw(first, "FUNCTION"))) break;
          this.report('Each case starts with a value and a colon, for example 1 : OUTPUT "One", or with OTHERWISE.', l.line);
          this.nextLine();
        }
        node.endLine = this.closeWith("ENDCASE", "CASE OF", line);
        return node;
      });
    } finally {
      this.caseDepth--;
    }
  }

  private parseCaseLabel(): CaseLabel {
    const message = "A case value must be written directly, such as 1, 'A' or \"Yes\".";
    const lo = this.parseLiteralValue(message);
    if (this.acceptKw("TO")) {
      const hi = this.parseLiteralValue(message);
      return { k: "range", lo, hi };
    }
    return { k: "value", value: lo };
  }

  private parseFor(ctx: Ctx): ForStmt {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    const node: ForStmt = {
      k: "for", line, varName: "", varPos: posOf(kw), start: null, end: null, step: null, body: [],
    };
    try {
      const v = this.expectIdent("FOR needs a loop variable, for example FOR Count ← 1 TO 10.");
      node.varName = v.text;
      node.varPos = posOf(v);
      if (this.isOp(this.peek(), "=")) throw this.errAt(this.peek(), `Use ← in a FOR loop: FOR ${v.text} ← 1 TO 10.`);
      this.expectOp("←", `Write the loop like this: FOR ${v.text} ← 1 TO 10.`);
      node.start = this.parseExpr();
      this.expectKw("TO", `A FOR loop needs TO: FOR ${v.text} ← 1 TO 10.`);
      node.end = this.parseExpr();
      if (this.acceptKw("STEP")) node.step = this.parseExpr();
      if (this.isDo(this.peek())) throw this.errAt(this.peek(), "FOR loops don't use DO.");
      this.expectEol();
    } catch (e) {
      this.reportErr(e);
    }
    this.nextLine();

    return this.withClosers(["NEXT"], () => {
      node.body = this.parseBlock(this.child(ctx));
      const l = this.cur;
      if (l && this.isKw(l.tokens[0], "NEXT")) {
        this.checkCase(l.tokens[0]);
        node.endLine = l.line;
        this.ti = 1;
        const t = this.peek();
        const want = node.varName || "Count";
        if (!t) {
          this.report(`NEXT must name the loop variable: NEXT ${want}.`, l.line);
        } else if (t.kind !== "ident") {
          this.reportAt(t, `NEXT must be followed by the loop variable's name: NEXT ${want}.`);
        } else {
          this.ti++;
          if (node.varName && t.text.toUpperCase() !== node.varName.toUpperCase()) {
            this.reportAt(t, `This NEXT should name the loop variable of the FOR on line ${line}: NEXT ${node.varName}.`);
          } else if (!this.atEol()) {
            this.reportAt(this.peek()!, "Nothing else can go on the NEXT line.");
          }
        }
        this.nextLine();
      } else {
        this.closeWith("NEXT", "FOR", line);
      }
      return node;
    });
  }

  private parseRepeat(ctx: Ctx): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    if (!this.atEol()) this.reportAt(this.peek()!, "Put the loop's statements on the lines after REPEAT.");
    this.nextLine();
    return this.withClosers(["UNTIL"], () => {
      const body = this.parseBlock(this.child(ctx));
      const l = this.cur;
      let cond: Expr | null = null;
      let endLine: number | undefined;
      if (l && this.isKw(l.tokens[0], "UNTIL")) {
        this.checkCase(l.tokens[0]);
        endLine = l.line;
        this.ti = 1;
        try {
          if (this.atEol()) throw this.errAt(l.tokens[0], "UNTIL needs a condition, for example UNTIL Count = 10.");
          cond = this.parseExpr();
          this.expectEol();
        } catch (e) {
          this.reportErr(e);
        }
        this.nextLine();
      } else {
        this.closeWith("UNTIL", "REPEAT", line);
      }
      return { k: "repeat", line, body, cond, endLine };
    });
  }

  private parseWhile(ctx: Ctx): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    let cond: Expr | null = null;
    try {
      if (this.atEol()) throw this.errAt(kw, `WHILE needs a condition, for example WHILE Count < 10${this.isAS ? "" : " DO"}.`);
      cond = this.parseExpr();
      const t = this.peek();
      if (this.isAS) {
        if (this.isDo(t)) throw this.errAt(t, "At AS Level, WHILE has no DO. Write just WHILE Count < 10.");
      } else if (!this.acceptKw("DO")) {
        throw this.errAt(t, this.atEol()
          ? "At O Level / IGCSE, WHILE needs DO at the end of the line: WHILE Count < 10 DO."
          : `Expected DO, but found "${t!.text}".`);
      }
      this.expectEol();
    } catch (e) {
      this.reportErr(e);
    }
    this.nextLine();
    return this.withClosers(["ENDWHILE"], () => {
      const body = this.parseBlock(this.child(ctx));
      const endLine = this.closeWith("ENDWHILE", "WHILE", line);
      return { k: "while", line, cond, body, endLine };
    });
  }

  private parseCall(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const name = this.expectIdent(`CALL needs a procedure name, for example CALL ShowMenu${this.isAS ? "()" : ""}.`);
    let args: Expr[] = [];
    if (this.isOp(this.peek(), "(")) {
      args = this.parseArgList().args;
    } else if (this.isAS && this.atEol()) {
      this.reportAt(name, `At AS Level, write brackets even when there are no values: CALL ${name.text}().`);
    }
    this.expectEol("Put the procedure's values in brackets, for example CALL Name(A, B).");
    this.nextLine();
    return { k: "call", line: kw.line, name: name.text, namePos: posOf(name), args };
  }

  private parseReturn(ctx: Ctx): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    if (this.atEol()) {
      throw this.errAt(kw, ctx.sub === "procedure"
        ? "A PROCEDURE can't use RETURN. Only a FUNCTION returns a value."
        : "RETURN needs a value, for example RETURN Total.");
    }
    const value = this.parseExpr();
    this.expectEol();
    this.nextLine();
    return { k: "return", line: kw.line, value };
  }

  private parseFileName(): FileName {
    const t = this.peek();
    if (t && t.kind === "string") {
      this.ti++;
      return { k: "lit", value: t.value, pos: posOf(t) };
    }
    if (t && t.kind === "ident") {
      this.ti++;
      return { k: "name", name: t.text, pos: posOf(t) };
    }
    throw this.errAt(t, 'Give the file name as a string, such as "Data.txt", or as a STRING variable.');
  }

  private parseOpenFile(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const file = this.parseFileName();
    const modes = this.isAS ? "FOR READ, FOR WRITE or FOR APPEND" : "FOR READ or FOR WRITE";
    this.expectKw("FOR", `Say how to open the file, for example OPENFILE "Data.txt" FOR READ. It can be opened ${modes}.`);
    const m = this.peek();
    const ok = this.isKw(m, "READ") || this.isKw(m, "WRITE") || (this.isAS && this.isKw(m, "APPEND"));
    if (!ok || !m) throw this.errAt(m, `A file can be opened ${modes}.`);
    this.checkCase(m);
    this.ti++;
    this.expectEol();
    this.nextLine();
    return { k: "openfile", line: kw.line, file, mode: m.value as "READ" | "WRITE" | "APPEND" };
  }

  private parseReadFile(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const file = this.parseFileName();
    this.expectOp(",", 'Write READFILE "Data.txt", Variable.');
    const target = this.parseTarget('READFILE needs a variable, for example READFILE "Data.txt", LineOfText.');
    this.expectEol();
    this.nextLine();
    return { k: "readfile", line: kw.line, file, target };
  }

  private parseWriteFile(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const file = this.parseFileName();
    this.expectOp(",", `Write WRITEFILE "Data.txt", ${this.isAS ? "Data" : "Variable"}.`);
    if (this.isAS) {
      const value = this.parseExpr();
      this.expectEol();
      this.nextLine();
      return { k: "writefile", line: kw.line, file, value };
    }
    const writeMsg = 'WRITEFILE writes the value of a variable. Store the value in a variable first, then write WRITEFILE "Data.txt", Variable.';
    const t = this.peek();
    if (!t || t.kind !== "ident") throw this.errAt(t, writeMsg);
    const value = this.parsePlace(writeMsg);
    this.expectEol(writeMsg);
    this.nextLine();
    return { k: "writefile", line: kw.line, file, value };
  }

  private parseCloseFile(): Stmt {
    const kw = this.next();
    this.checkCase(kw);
    const file = this.parseFileName();
    this.expectEol();
    this.nextLine();
    return { k: "closefile", line: kw.line, file };
  }

  private parseSub(ctx: Ctx, isFunc: boolean): ProcedureDef | FunctionDef {
    const kw = this.next();
    this.checkCase(kw);
    const word = isFunc ? "FUNCTION" : "PROCEDURE";
    const line = kw.line;
    if (!ctx.top) {
      this.report(`A ${word} must be defined at the top level of the program, not inside a block such as IF or a loop.`, line);
    }
    let name = "";
    let namePos = posOf(kw);
    const params: Param[] = [];
    let returnType: TypeNode | null = null;
    try {
      const n = this.expectIdent(`${word} needs a name, for example ${word} ShowMenu${this.isAS ? "()" : ""}.`);
      name = n.text;
      namePos = posOf(n);
      if (this.acceptOp("(")) {
        if (!this.acceptOp(")")) {
          params.push(this.parseParam(false));
          while (this.acceptOp(",")) params.push(this.parseParam(params[params.length - 1].byRef));
          this.expectOp(")", "Close the parameter list with ).");
        }
      } else if (this.isAS) {
        this.reportAt(n, `At AS Level, put brackets after the name even with no parameters: ${word} ${n.text}().`);
      }
      if (isFunc) {
        if (this.isKw(this.peek(), "RETURN")) {
          throw this.errAt(this.peek(), "Use RETURNS (with an S) in the function header: FUNCTION Name(…) RETURNS INTEGER.");
        }
        this.expectKw("RETURNS", "A FUNCTION must say what type it returns: FUNCTION Name(…) RETURNS INTEGER.");
        const t = this.peek();
        if (this.isKw(t, "ARRAY")) throw this.errAt(t, "A FUNCTION can't return a whole array.");
        if (!this.isBasicType(t) && !(this.isAS && t?.kind === "ident")) {
          throw this.errAt(t, `RETURNS must be followed by a type: ${this.typeList()}.`);
        }
        returnType = this.parseSimpleType();
      } else if (this.isKw(this.peek(), "RETURNS")) {
        throw this.errAt(this.peek(), "A PROCEDURE doesn't return a value. Use a FUNCTION if you need RETURNS.");
      }
      this.expectEol();
    } catch (e) {
      this.reportErr(e);
    }
    this.nextLine();

    const endKw = isFunc ? "ENDFUNCTION" : "ENDPROCEDURE";
    const otherEnd = isFunc ? "ENDPROCEDURE" : "ENDFUNCTION";
    return this.withClosers([endKw, otherEnd], () => {
      const body = this.parseBlock({ top: false, sub: isFunc ? "function" : "procedure", caseBody: false });
      let endLine: number | undefined;
      const l = this.cur;
      if (l && this.isKw(l.tokens[0], otherEnd)) {
        this.reportAt(l.tokens[0], `A ${word} ends with ${endKw}, not ${otherEnd}.`);
        endLine = l.line;
        this.nextLine();
      } else {
        endLine = this.closeWith(endKw, word, line);
      }
      if (isFunc) return { k: "function", line, name, namePos, params, returnType, body, endLine };
      return { k: "procedure", line, name, namePos, params, body, endLine };
    });
  }

  /** AS Level: BYREF / BYVAL before a parameter also applies to the ones after it. */
  private parseParam(byRefBefore: boolean): Param {
    let byRef = byRefBefore;
    let modePos: Pos | undefined;
    const m = this.peek();
    if (this.isKw(m, "BYREF") || this.isKw(m, "BYVAL")) {
      this.checkCase(m);
      this.ti++;
      byRef = m.value === "BYREF";
      modePos = posOf(m);
    }
    const n = this.expectIdent("Each parameter needs a name and a type, for example Score : INTEGER.");
    this.expectOp(":", `Give the parameter a type: ${n.text} : INTEGER.`);
    const typeNode = this.parseType();
    return { name: n.text, namePos: posOf(n), typeNode, byRef, modePos };
  }

  /** TYPE Name … ENDTYPE (AS Level records). */
  private parseTypeDef(ctx: Ctx): TypeDef {
    const kw = this.next();
    this.checkCase(kw);
    const line = kw.line;
    if (!ctx.top) this.report("A TYPE must be defined at the top level of the program, not inside a block or subroutine.", line);
    const node: TypeDef = { k: "typedef", line, name: "", namePos: posOf(kw), fields: [] };
    try {
      const n = this.expectIdent("TYPE needs a name, for example TYPE StudentRecord.");
      node.name = n.text;
      node.namePos = posOf(n);
      if (this.isOp(this.peek(), "=")) {
        const after = this.peek(1);
        const what = this.isOp(after, "(") ? "Enumerated types" : this.isOp(after, "*") ? "Pointer types" : "Set and pointer types";
        throw this.errAt(this.peek(), `${what} are A Level only. At AS Level, TYPE defines a record: TYPE Name, then DECLARE lines, then ENDTYPE.`);
      }
      this.expectEol("Put the record's fields on the following lines, each as DECLARE Field : Type.");
    } catch (e) {
      this.reportErr(e);
      this.nextLine();
      // Skip to ENDTYPE (if there is one) so the fields aren't read as statements.
      const end = this.code.slice(this.li).findIndex((l) => this.isKw(l.tokens[0], "ENDTYPE"));
      if (end >= 0) {
        this.li += end + 1;
        this.ti = 0;
      }
      return node;
    }
    this.nextLine();
    return this.withClosers(["ENDTYPE"], () => {
      while (this.cur) {
        const first = this.cur.tokens[0];
        if (first.kind === "keyword" && CLOSERS.has(first.value)) break;
        if (this.isKw(first, "DECLARE")) {
          try {
            node.fields.push(this.parseFieldDecl());
          } catch (e) {
            this.reportErr(e);
            this.nextLine();
          }
          continue;
        }
        if (this.isKw(first, "PROCEDURE") || this.isKw(first, "FUNCTION") || this.isKw(first, "TYPE")) break;
        this.reportAt(first, "Only DECLARE lines can go between TYPE and ENDTYPE.");
        this.nextLine();
      }
      node.endLine = this.closeWith("ENDTYPE", "TYPE", line);
      if (node.fields.length === 0 && node.endLine !== undefined) {
        this.report(`The record type ${node.name} needs at least one field: DECLARE Field : Type.`, line);
      }
      return node;
    });
  }

  private parseFieldDecl(): FieldDecl {
    const kw = this.next();
    this.checkCase(kw);
    const name = this.expectIdent("Each field needs a name and a type, for example DECLARE LastName : STRING.");
    this.expectOp(":", `Put a colon between the field name and its type: DECLARE ${name.text} : STRING.`);
    const typeNode = this.parseType();
    this.expectEol();
    this.nextLine();
    return { name: name.text, namePos: posOf(name), typeNode, line: kw.line };
  }

  // ---- expressions ----------------------------------------------------------

  private parseExpr(): Expr {
    const e = this.parseBinary(0);
    this.validateRoot(e);
    return e;
  }

  private binOpOf(t: Token | undefined): string | null {
    if (!t) return null;
    if (t.kind === "op" && t.value in this.prec) return t.value;
    if (t.kind === "keyword") {
      if (t.value === "AND" || t.value === "OR") return t.value;
      if (t.value === "DIV" || t.value === "MOD") {
        if (this.isAS) return t.value;
        throw this.errAt(t, `At O Level / IGCSE, ${t.value} is written as a function: ${t.value}(A, B).`);
      }
    }
    return null;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const op = this.binOpOf(t);
      if (!op || !t) break;
      const prec = this.prec[op];
      if (prec < minPrec) break;
      if (t.kind === "keyword") this.checkCase(t);
      this.ti++;
      if (this.atEol()) throw this.errAt(t, `Something is missing after ${op}.`);
      const right = this.parseBinary(op === "^" ? prec : prec + 1);
      left = { k: "binary", op, left, right, pos: span(left.pos, right.pos) };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (this.isOp(t, "-")) {
      this.ti++;
      const operand = this.parseBinary(this.negPrec);
      return { k: "unary", op: "-", operand, pos: span(posOf(t), operand.pos) };
    }
    if (this.isKw(t, "NOT")) {
      this.checkCase(t);
      this.ti++;
      const operand = this.parseBinary(3);
      return { k: "unary", op: "NOT", operand, pos: span(posOf(t), operand.pos) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (!t) throw this.errAt(undefined, "This line ends too early: a value is missing.");
    switch (t.kind) {
      case "int": case "real": case "char": case "string": case "date":
        this.ti++;
        return this.literalFrom(t);
      case "keyword":
        if (t.value === "TRUE" || t.value === "FALSE") {
          this.checkCase(t);
          this.ti++;
          return this.literalFrom(t);
        }
        if (t.value in this.spec.builtins) return this.parseBuiltin(t);
        if (this.isAS && (t.value === "DIV" || t.value === "MOD") && this.isOp(this.peek(1), "(")) {
          throw this.errAt(t, `At AS Level, ${t.value} is an operator between two values: A ${t.value} B.`);
        }
        if (t.badCase) throw this.errAt(t, this.keywordAsName(t));
        throw this.errAt(t, `Expected a value, but found the keyword ${t.value}.`);
      case "ident": {
        this.ti++;
        if (this.isOp(this.peek(), "(")) {
          const r = this.parseArgList();
          return this.parsePostfix({ k: "call", name: t.text, namePos: posOf(t), args: r.args, pos: span(posOf(t), r.end) });
        }
        return this.parsePostfix({ k: "name", name: t.text, pos: posOf(t) });
      }
      case "op":
        if (t.value === "(") {
          this.ti++;
          if (this.isOp(this.peek(), ")")) throw this.errAt(this.peek(), "These brackets are empty.");
          const e = this.parseBinary(0);
          this.expectOp(")", "A bracket ( was opened here but never closed.");
          e.paren = true;
          return e;
        }
        if (t.value === "←") throw this.errAt(t, "← is only used to assign a value. To compare, use =.");
        throw this.errAt(t, `Expected a value, but found "${t.text}".`);
    }
  }

  /** [indices] and (AS) .Field after a name. */
  private parsePostfix(base: Expr): Expr {
    let e = base;
    for (;;) {
      const t = this.peek();
      if (this.isOp(t, "[")) {
        const r = this.parseIndices();
        e = { k: "index", base: e, indices: r.indices, pos: span(e.pos, r.end) };
        continue;
      }
      if (this.isAS && this.isOp(t, ".")) {
        this.ti++;
        const f = this.peek();
        if (!f || (f.kind !== "ident" && f.kind !== "keyword")) throw this.errAt(f ?? t, "Write a field name after the dot, for example Pupil.LastName.");
        this.ti++;
        e = { k: "field", object: e, field: f.text, fieldPos: posOf(f), pos: span(e.pos, posOf(f)) };
        continue;
      }
      return e;
    }
  }

  private parseBuiltin(t: Token): Expr {
    this.checkCase(t);
    this.ti++;
    const info = this.spec.builtins[t.value];
    if (!this.isOp(this.peek(), "(")) {
      throw this.errAt(t, info.arity === 0
        ? `Write ${t.value}() with empty brackets.`
        : `${t.value} needs its values in brackets: ${info.usage}.`);
    }
    const r = this.parseArgList();
    if (r.args.length !== info.arity) {
      const n = info.arity;
      throw this.errAt(t, `${t.value} needs ${n === 0 ? "no values" : n === 1 ? "1 value" : `${n} values`}: ${info.usage}.`);
    }
    return { k: "builtin", name: t.value, args: r.args, pos: span(posOf(t), r.end) };
  }

  private parseArgList(): { args: Expr[]; end: Pos } {
    this.expectOp("(", "Expected (.");
    const args: Expr[] = [];
    const close = this.acceptOp(")");
    if (close) return { args, end: posOf(close) };
    args.push(this.parseBinary(0));
    while (this.acceptOp(",")) args.push(this.parseBinary(0));
    const end = this.expectOp(")", "Close the brackets with ), with a comma between values.");
    return { args, end: posOf(end) };
  }

  private parseIndices(): { indices: Expr[]; end: Pos } {
    const open = this.expectOp("[", "Expected [.");
    const indices = [this.parseBinary(0)];
    while (this.acceptOp(",")) indices.push(this.parseBinary(0));
    const end = this.expectOp("]", "Close the index with ].");
    if (indices.length > 2) throw this.errAt(open, "Arrays have at most 2 dimensions, so use at most 2 indices.");
    if (this.isOp(this.peek(), "[")) {
      throw this.errAt(this.peek(), "For a 2D array, put both indices in one pair of brackets: Grid[Row, Column].");
    }
    return { indices, end: posOf(end) };
  }

  // ---- the bracket rule (O-OP-2 / OP-2) ------------------------------------

  private validateRoot(root: Expr): void {
    const v = findViolation(root);
    if (v) {
      const { parent, child } = v;
      const pk = opKind(parent);
      const ck = opKind(child);
      let message: string;
      if (pk === "rel" && ck === "rel") {
        message = "Comparisons can't be chained. Join them with AND or OR, each in brackets, for example (A < B) AND (B < C).";
      } else if ((pk === "and" && ck === "or") || (pk === "or" && ck === "and")) {
        message = `AND and OR can't be mixed without brackets. Show which comes first, for example: ${this.render(root)}`;
      } else {
        message = `Add brackets to show the order of operations: ${this.render(root)}. Without brackets you can only rely on * and / being done before + and -.`;
      }
      this.report(message, parent.pos.line, parent.pos.col, parent.pos.endCol);
    }
    // Arguments and indices are separate expressions with their own brackets.
    forEachNested(root, (e) => this.validateRoot(e));
  }

  private render(e: Expr): string {
    const inner = this.renderBare(e);
    return e.paren ? `(${inner})` : inner;
  }

  private renderBare(e: Expr): string {
    switch (e.k) {
      case "unary":
        return (e.op === "-" ? "-" : "NOT ") + this.renderChild(e, e.operand);
      case "binary":
        return `${this.renderChild(e, e.left)} ${e.op} ${this.renderChild(e, e.right)}`;
      default: {
        const text = this.lineText.get(e.pos.line) ?? "";
        return text.slice(e.pos.col - 1, e.pos.endCol - 1);
      }
    }
  }

  private renderChild(parent: Expr, child: Expr): string {
    const s = this.render(child);
    return violates(parent, child) ? `(${s})` : s;
  }
}

type OpKind = "atom" | "neg" | "not" | "add" | "mul" | "int" | "cat" | "pow" | "rel" | "and" | "or";

function opKind(e: Expr): OpKind {
  if (e.k === "unary") return e.op === "-" ? "neg" : "not";
  if (e.k !== "binary") return "atom";
  switch (e.op) {
    case "+": case "-": return "add";
    case "*": case "/": return "mul";
    case "DIV": case "MOD": return "int";
    case "&": return "cat";
    case "^": return "pow";
    case "AND": return "and";
    case "OR": return "or";
    default: return "rel";
  }
}

// What each operator may have directly underneath it without brackets.
const ALLOWED: Record<OpKind, OpKind[]> = {
  atom: [],
  add: ["atom", "neg", "add", "mul"],
  mul: ["atom", "neg", "add", "mul"],
  int: ["atom", "neg", "int"],
  cat: ["atom", "cat"],
  pow: ["atom"],
  neg: ["atom"],
  not: ["atom"],
  rel: ["atom", "neg", "add", "mul", "int", "cat", "pow"],
  and: ["atom", "and"],
  or: ["atom", "or"],
};

function violates(parent: Expr, child: Expr): boolean {
  if (child.paren) return false;
  return !ALLOWED[opKind(parent)].includes(opKind(child));
}

function childrenOf(e: Expr): Expr[] {
  if (e.k === "unary") return [e.operand];
  if (e.k === "binary") return [e.left, e.right];
  return [];
}

function findViolation(e: Expr): { parent: Expr; child: Expr } | null {
  for (const c of childrenOf(e)) {
    if (violates(e, c)) return { parent: e, child: c };
    if (!c.paren) {
      const v = findViolation(c);
      if (v) return v;
    }
  }
  // Bracketed sub-expressions are their own level.
  for (const c of childrenOf(e)) {
    if (c.paren) {
      const v = findViolation(c);
      if (v) return v;
    }
  }
  return null;
}

/** Calls fn on each argument / index expression found inside e (not descending into them). */
function forEachNested(e: Expr, fn: (e: Expr) => void): void {
  switch (e.k) {
    case "call": case "builtin": e.args.forEach(fn); break;
    case "index": forEachNested(e.base, fn); e.indices.forEach(fn); break;
    case "field": forEachNested(e.object, fn); break;
    case "unary": forEachNested(e.operand, fn); break;
    case "binary": forEachNested(e.left, fn); forEachNested(e.right, fn); break;
  }
}
