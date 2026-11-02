// Step 3b: static checks (README "Errors and warnings – before running").
// Declarations, types, scope, CALL usage, RETURN placement and define-before-use.

import type { Diagnostics } from "./diagnostics.ts";
import type {
  BasicTypeName, BoundNode, CaseStmt, Expr, FileName, ForStmt, FunctionDef, LitExpr, PlaceExpr, Pos,
  ProcedureDef, Program, SType, Stmt, SubSym, Target, TypeDef, TypeNode, Value, VarRef, VarSym,
} from "./ast.ts";
import { isPlace, rootName } from "./ast.ts";
import { formatDate } from "./dates.ts";

export const MAX_ARRAY_ELEMENTS = 100_000;

const NUMERIC = new Set<BasicTypeName>(["INTEGER", "REAL"]);
const TEXT = new Set<BasicTypeName>(["CHAR", "STRING"]);

const a = (t: string) => (/^[AEIOU]/.test(t) ? `an ${t}` : `a ${t}`);

export function typeToString(t: SType): string {
  if (t.k === "basic") return t.name;
  if (t.k === "record") return t.name;
  return `ARRAY[${t.dims.map((d) => `${d.lo}:${d.hi}`).join(", ")}] OF ${typeToString(t.elem)}`;
}

export function sameType(x: SType, y: SType): boolean {
  if (x.k === "basic" && y.k === "basic") return x.name === y.name;
  if (x.k === "record" && y.k === "record") return x.key === y.key;
  if (x.k === "array" && y.k === "array") {
    return sameType(x.elem, y.elem) && x.dims.length === y.dims.length &&
      x.dims.every((d, i) => d.lo === y.dims[i].lo && d.hi === y.dims[i].hi);
  }
  return false;
}

export function check(program: Program, diags: Diagnostics): void {
  new Checker(program, diags).run();
}

interface TopCall {
  line: number;
  key: string;
  pos: Pos;
}

interface TypeInfo {
  name: string;
  line: number;
  type: SType & { k: "record" };
}

const FALLBACK: SType = { k: "basic", name: "INTEGER" };

class Checker {
  private program: Program;
  private diags: Diagnostics;
  private isAS: boolean;
  private globals = new Map<string, VarSym>();
  private subs = new Map<string, SubSym>();
  private types = new Map<string, TypeInfo>();
  private cur: SubSym | null = null;
  private loopVars: string[] = [];
  private topCalls: TopCall[] = [];
  private spellingWarned = new Set<string>();
  private line = 0;

  constructor(program: Program, diags: Diagnostics) {
    this.program = program;
    this.diags = diags;
    this.isAS = program.level === "AS";
  }

  private error(message: string, pos: Pos | number): void {
    if (typeof pos === "number") this.diags.error(message, pos);
    else this.diags.error(message, pos.line, pos.col, pos.endCol);
  }
  private warning(message: string, pos: Pos | number): void {
    if (typeof pos === "number") this.diags.warning(message, pos);
    else this.diags.warning(message, pos.line, pos.col, pos.endCol);
  }

  run(): void {
    // Pass 1: everything with a name.
    for (const s of this.program.body) if (s.k === "typedef") this.collectType(s);
    this.collectGlobals(this.program.body);
    for (const s of this.program.body) {
      if (s.k === "procedure" || s.k === "function") this.collectSub(s);
    }
    for (const sub of this.subs.values()) this.collectLocals(sub);

    // Pass 2: check every statement.
    this.cur = null;
    this.checkBlock(this.program.body);
    for (const sub of this.subs.values()) {
      this.cur = sub;
      this.loopVars = [];
      this.checkBlock(sub.node.body);
    }
    this.cur = null;

    // Pass 3: define before use (SUB-1) and globals used by subroutines (P-SCOPE-2).
    this.checkDefineBeforeUse();

    this.program.globals = this.globals;
    this.program.subs = this.subs;
  }

  // ---- pass 1 ---------------------------------------------------------------

  private nameStyle(name: string, pos: Pos): void {
    if (name.length > 1 && /^[a-z]/.test(name)) {
      this.warning(`Names usually start with a capital letter (PascalCase), for example ${name[0].toUpperCase()}${name.slice(1)}.`, pos);
    }
  }

  private describe(key: string): string | null {
    const g = this.globals.get(key);
    if (g) return `${g.kind === "const" ? "a constant" : g.type.k === "array" ? "an array" : "a variable"} on line ${g.line}`;
    const s = this.subs.get(key);
    if (s) return `${s.kind === "proc" ? "a procedure" : "a function"} on line ${s.line}`;
    const t = this.types.get(key);
    if (t) return `a record type on line ${t.line}`;
    return null;
  }

  private collectType(s: TypeDef): void {
    if (!s.name) return;
    const key = s.name.toUpperCase();
    const existing = this.describe(key);
    if (existing) {
      this.error(`${s.name} is already used as ${existing}.`, s.namePos);
      return;
    }
    this.nameStyle(s.name, s.namePos);
    const type: SType & { k: "record" } = { k: "record", name: s.name, key, fields: new Map() };
    for (const f of s.fields) {
      const fk = f.name.toUpperCase();
      if (type.fields.has(fk)) {
        this.error(`${s.name} already has a field called ${type.fields.get(fk)!.name}.`, f.namePos);
        continue;
      }
      if (f.typeNode.k === "named" && f.typeNode.name.toUpperCase() === key) {
        this.error(`A record can't contain a field of its own type.`, f.typeNode.pos);
        continue;
      }
      type.fields.set(fk, { name: f.name, type: this.resolveType(f.typeNode, f.line, null) });
    }
    this.types.set(key, { name: s.name, line: s.line, type });
  }

  /** Walks the main program's blocks (not subroutines) in source order. */
  private collectGlobals(stmts: Stmt[]): void {
    for (const s of stmts) {
      if (s.k === "declare" || s.k === "constant") {
        const key = s.name.toUpperCase();
        const existing = this.describe(key);
        if (existing) {
          this.error(`${s.name} is already declared as ${existing}.`, s.namePos);
          continue;
        }
        this.nameStyle(s.name, s.namePos);
        const sym: VarSym = s.k === "declare"
          ? { kind: "var", name: s.name, key, type: this.resolveType(s.typeNode, s.line, null), line: s.line, scope: "global" }
          : { kind: "const", name: s.name, key, type: { k: "basic", name: s.value.litType }, line: s.line, scope: "global", constValue: s.value.value };
        this.globals.set(key, sym);
      }
      for (const b of nestedBlocks(s)) this.collectGlobals(b);
    }
  }

  private collectSub(node: ProcedureDef | FunctionDef): void {
    const key = node.name.toUpperCase();
    if (!key) return;
    const existing = this.describe(key);
    if (existing) {
      this.error(`${node.name} is already used as ${existing}.`, node.namePos);
      return;
    }
    this.nameStyle(node.name, node.namePos);
    const sub: SubSym = {
      kind: node.k === "procedure" ? "proc" : "func",
      name: node.name, key, line: node.line, params: [],
      returnType: node.k === "function" && node.returnType ? this.resolveType(node.returnType, node.line, null) : undefined,
      locals: new Map(), node, calls: new Set(), globalsUsed: new Map(),
    };
    node.sym = sub;
    this.subs.set(key, sub);
  }

  private collectLocals(sub: SubSym): void {
    const node = sub.node;
    const add = (name: string, pos: Pos, make: () => VarSym) => {
      const key = name.toUpperCase();
      const local = sub.locals.get(key);
      if (local) {
        this.error(`${name} is already declared in ${sub.name} (line ${local.line}).`, pos);
        return;
      }
      if (this.isAS) {
        const t = this.types.get(key);
        if (t) {
          this.error(`${name} is already the name of a record type (line ${t.line}).`, pos);
          return;
        }
      } else {
        const global = this.describe(key);
        if (global) {
          this.error(`${name} is already the name of ${global}. At O Level / IGCSE a local variable or parameter can't share a name with anything global, so choose a different name.`, pos);
          return;
        }
      }
      this.nameStyle(name, pos);
      const sym = make();
      sub.locals.set(key, sym);
      return sym;
    };

    for (const p of node.params) {
      if (p.byRef && node.k === "function") {
        this.error("A FUNCTION can't have BYREF parameters. Use a PROCEDURE, or pass the value BYVAL.", p.modePos ?? p.namePos);
      }
      const sym = add(p.name, p.namePos, () => ({
        kind: "param", name: p.name, key: p.name.toUpperCase(), type: this.resolveType(p.typeNode, node.line, sub),
        line: node.line, scope: "local", byRef: p.byRef,
      }));
      if (sym) sub.params.push(sym);
    }
    if (!this.isAS && node.params.length > 3) {
      this.warning(`${sub.name} has ${node.params.length} parameters. Exam questions never use more than 3.`, node.namePos);
    }

    const walk = (stmts: Stmt[]) => {
      for (const s of stmts) {
        if (s.k === "declare") {
          add(s.name, s.namePos, () => ({
            kind: "var", name: s.name, key: s.name.toUpperCase(), type: this.resolveType(s.typeNode, s.line, sub),
            line: s.line, scope: "local",
          }));
        } else if (s.k === "constant") {
          add(s.name, s.namePos, () => ({
            kind: "const", name: s.name, key: s.name.toUpperCase(), type: { k: "basic", name: s.value.litType },
            line: s.line, scope: "local", constValue: s.value.value,
          }));
        }
        for (const b of nestedBlocks(s)) walk(b);
      }
    };
    walk(node.body);
  }

  private resolveType(t: TypeNode, line: number, sub: SubSym | null): SType {
    if (t.k === "basic") return { k: "basic", name: t.name };
    if (t.k === "named") {
      const info = this.types.get(t.name.toUpperCase());
      if (!info) {
        this.error(`There is no type called ${t.name}. Use INTEGER, REAL, CHAR, STRING, BOOLEAN or DATE, or define a record with TYPE ${t.name} … ENDTYPE.`, t.pos);
        return FALLBACK;
      }
      if (info.line > line) {
        this.error(`The type ${info.name} is defined on line ${info.line}, below this line. Define types at the top of the program.`, t.pos);
        return FALLBACK;
      }
      this.spelling(t.name, info.name, t.pos);
      return info.type;
    }
    const dims = t.dims.map((d) => {
      const lo = this.resolveBound(d.lo, line, sub);
      const hi = this.resolveBound(d.hi, line, sub);
      if (lo !== null && hi !== null && lo > hi) {
        this.error(`The lower bound (${lo}) can't be bigger than the upper bound (${hi}).`, t.pos);
      }
      return { lo: lo ?? 1, hi: hi ?? 1 };
    });
    const size = dims.reduce((n, d) => n * Math.max(0, d.hi - d.lo + 1), 1);
    if (size > MAX_ARRAY_ELEMENTS) {
      this.error(`This array would hold ${size.toLocaleString("en-GB")} elements. Keep arrays under ${MAX_ARRAY_ELEMENTS.toLocaleString("en-GB")} elements.`, t.pos);
    }
    return { k: "array", elem: this.resolveType(t.elem, line, sub), dims };
  }

  private resolveBound(b: BoundNode, line: number, sub: SubSym | null): number | null {
    if (b.k === "num") return b.value;
    const key = b.name.toUpperCase();
    const sym = sub?.locals.get(key) ?? this.globals.get(key);
    if (!sym || sym.kind !== "const") {
      this.error(`An array bound must be a whole number or an INTEGER constant, and ${b.name} isn't a constant${sym ? "" : " declared above this line"}.`, b.pos);
      return null;
    }
    if (sym.scope === "global" && !sub && sym.line >= line) {
      this.error(`The constant ${b.name} is declared on line ${sym.line}, below this line.`, b.pos);
      return null;
    }
    if (sym.type.k !== "basic" || sym.type.name !== "INTEGER") {
      this.error(`An array bound must be an INTEGER, but ${b.name} is ${a(typeToString(sym.type))}.`, b.pos);
      return null;
    }
    return sym.constValue as number;
  }

  // ---- name lookup ------------------------------------------------------------

  private spelling(written: string, declared: string, pos: Pos): void {
    if (written === declared) return;
    const k = `${declared}|${written}`;
    if (this.spellingWarned.has(k)) return;
    this.spellingWarned.add(k);
    this.warning(`${written} is written as ${declared} where it was declared. Use the same capital letters every time.`, pos);
  }

  /** Finds a variable, constant or parameter. Reports a helpful error and returns null if there isn't one. */
  private lookupVar(name: string, pos: Pos): VarRef | null {
    const key = name.toUpperCase();
    if (this.cur) {
      const s = this.cur.locals.get(key);
      if (s) {
        if (s.kind !== "param" && s.line >= this.line) {
          this.error(`${name} is used before its ${s.kind === "const" ? "CONSTANT" : "DECLARE"} on line ${s.line}. Declare it above the line that uses it.`, pos);
        }
        this.spelling(name, s.name, pos);
        return { scope: "local", key, sym: s };
      }
    }
    const g = this.globals.get(key);
    if (g) {
      if (!this.cur && g.line >= this.line) {
        this.error(`${name} is used before its ${g.kind === "const" ? "CONSTANT" : "DECLARE"} on line ${g.line}. Declare it above the line that uses it.`, pos);
      }
      if (this.cur && !this.cur.globalsUsed.has(key)) this.cur.globalsUsed.set(key, this.line);
      this.spelling(name, g.name, pos);
      return { scope: "global", key, sym: g };
    }
    const sub = this.subs.get(key);
    if (sub) {
      this.error(`${name} is ${sub.kind === "proc" ? "a procedure" : "a function"}, not a variable.`, pos);
      return null;
    }
    const type = this.types.get(key);
    if (type) {
      this.error(`${name} is a record type, not a variable. Declare a variable of that type: DECLARE Item : ${type.name}.`, pos);
      return null;
    }
    const elsewhere = [...this.subs.values()].find((s) => s !== this.cur && s.locals.has(key));
    if (elsewhere) {
      this.error(`${name} is a local variable of ${elsewhere.name}, so it can only be used inside ${elsewhere.name}.`, pos);
      return null;
    }
    this.error(`${name} hasn't been declared. Add DECLARE ${name} : <type> above this line.`, pos);
    return null;
  }

  private recordCall(sub: SubSym, pos: Pos): void {
    if (this.cur) this.cur.calls.add(sub.key);
    else this.topCalls.push({ line: this.line, key: sub.key, pos });
  }

  private assignable(from: BasicTypeName, to: BasicTypeName): boolean {
    if (from === to || (from === "INTEGER" && to === "REAL") || (from === "CHAR" && to === "STRING")) return true;
    // AS Level: a STRING of length 1 can be used as a CHAR (checked when the program runs).
    return this.isAS && from === "STRING" && to === "CHAR";
  }

  /** Can a value of type `from` (from expression e) be stored where `to` is expected? */
  private canStore(from: SType, to: SType, e: Expr): boolean {
    if (from.k === "basic" && to.k === "basic") {
      if (this.assignable(from.name, to.name)) {
        if (this.isAS && from.name === "STRING" && to.name === "CHAR" && e.k === "lit" && String(e.value).length !== 1) return false;
        return true;
      }
      // STR_TO_NUM gives a number that can go into an INTEGER if it is whole (checked when running).
      return this.isAS && from.name === "REAL" && to.name === "INTEGER" && e.k === "builtin" && e.name === "STR_TO_NUM";
    }
    return sameType(from, to);
  }

  private label(e: Expr): string {
    if (e.k === "name") return e.name;
    if (e.k === "field") return `${this.label(e.object)}.${e.field}`;
    if (e.k === "index") return `${this.label(e.base)}[…]`;
    return "This value";
  }

  // ---- statements ---------------------------------------------------------

  private checkBlock(stmts: Stmt[]): void {
    for (const s of stmts) this.checkStmt(s);
  }

  private checkStmt(s: Stmt): void {
    this.line = s.line;
    switch (s.k) {
      case "declare": case "constant": case "procedure": case "function": case "typedef":
        return;
      case "assign": {
        const tt = this.checkTarget(s.target, "assign");
        const vt = this.checkValue(s.value);
        if (tt && vt && !this.canStore(vt, tt, s.value)) this.reportMismatch(this.label(s.target.place), tt, vt, s.value);
        return;
      }
      case "input":
        this.checkTarget(s.target, "input");
        return;
      case "output":
        for (const v of s.values) this.checkExpr(v);
        return;
      case "if":
        if (s.cond) this.checkCond(s.cond, "IF");
        this.checkBlock(s.thenBody);
        if (s.elseBody) this.checkBlock(s.elseBody);
        return;
      case "case":
        this.checkCase(s);
        return;
      case "for":
        this.checkFor(s);
        return;
      case "repeat":
        this.checkBlock(s.body);
        this.line = s.endLine ?? s.line;
        if (s.cond) this.checkCond(s.cond, "UNTIL");
        return;
      case "while":
        if (s.cond) this.checkCond(s.cond, "WHILE");
        this.checkBlock(s.body);
        return;
      case "call": {
        const key = s.name.toUpperCase();
        const sub = this.subs.get(key);
        if (!sub) {
          const v = this.globals.get(key) ?? this.cur?.locals.get(key);
          this.error(v ? `${s.name} is a variable, not a procedure.` : `There is no procedure called ${s.name}.`, s.namePos);
          return;
        }
        this.spelling(s.name, sub.name, s.namePos);
        if (sub.kind === "func") {
          this.error(`${sub.name} is a function, so it can't be used with CALL. Use its value instead, for example Result ← ${sub.name}(…).`, s.namePos);
          return;
        }
        s.sub = sub;
        this.checkArgs(sub, s.args, s.namePos);
        this.recordCall(sub, s.namePos);
        return;
      }
      case "return": {
        if (!this.cur) {
          this.error("RETURN can only be used inside a FUNCTION.", s.line);
          return;
        }
        if (this.cur.kind === "proc") {
          this.error("A PROCEDURE can't use RETURN. Only a FUNCTION returns a value.", s.line);
          return;
        }
        const t = this.checkValue(s.value);
        const rt = this.cur.returnType;
        if (t && rt && !this.canStore(t, rt, s.value)) {
          this.error(`${this.cur.name} RETURNS ${a(typeToString(rt))}, but this value is ${a(typeToString(t))}.`, s.value.pos);
        }
        return;
      }
      case "openfile": case "closefile":
        this.checkFileName(s.file);
        return;
      case "readfile": {
        this.checkFileName(s.file);
        const t = this.checkTarget(s.target, "readfile");
        if (this.isAS && t && !(t.k === "basic" && t.name === "STRING")) {
          this.error(`READFILE reads a whole line of text, so it needs a STRING variable, but ${this.label(s.target.place)} is ${a(typeToString(t))}. Use STR_TO_NUM to turn the text into a number.`, s.target.pos);
        }
        return;
      }
      case "writefile":
        this.checkFileName(s.file);
        if (this.isAS) {
          const t = this.checkExpr(s.value);
          if (t && !TEXT.has(t)) {
            this.error(`WRITEFILE writes text, but this value is ${a(t)}.${NUMERIC.has(t) ? " Turn it into a string first with NUM_TO_STR(x)." : ""}`, s.value.pos);
          }
        } else {
          this.checkTarget({ place: s.value as PlaceExpr, pos: s.value.pos }, "writefile");
        }
        return;
    }
  }

  private checkFileName(f: FileName): void {
    if (f.k === "lit") return;
    const ref = this.lookupVar(f.name, f.pos);
    if (!ref) return;
    f.ref = ref;
    const t = ref.sym.type;
    if (t.k !== "basic" || !TEXT.has(t.name)) {
      this.error(`A file name must be a STRING, but ${f.name} is ${a(typeToString(t))}.`, f.pos);
    }
  }

  private checkTarget(t: Target, purpose: "assign" | "input" | "readfile" | "writefile"): SType | null {
    const place = t.place;
    const type = this.checkPlace(place);
    const root = rootName(place);
    const sym = root?.ref?.sym;
    if (!type || !sym || !root?.ref) return null;
    const changes = purpose !== "writefile";
    if (sym.kind === "const" && changes) {
      this.error(`${sym.name} is a constant, so its value can't be changed.`, t.pos);
      return null;
    }
    if (type.k !== "basic") {
      if (purpose === "assign" && this.isAS) return type;
      const what = type.k === "array" ? "an array" : "a record";
      if (purpose === "writefile") {
        this.error(`${this.label(place)} is ${what}. Write its ${type.k === "array" ? "elements" : "fields"} one at a time.`, t.pos);
      } else if (type.k === "array") {
        this.error(`${this.label(place)} is an array. Arrays are filled one element at a time, for example with a FOR loop.`, t.pos);
      } else {
        this.error(`${this.label(place)} is a record. ${purpose === "assign" ? "Assign" : "Fill"} its fields one at a time, for example ${this.label(place)}.Field.`, t.pos);
      }
      return null;
    }
    if (changes && place.k === "name" && this.loopVars.includes(root.ref.key)) {
      this.error(`${sym.name} is the loop variable of the FOR loop it is inside, so it can't be changed in the loop.`, t.pos);
    }
    return type;
  }

  private reportMismatch(name: string, to: SType, from: SType, value: Expr): void {
    const ts = typeToString(to);
    const fs = typeToString(from);
    let msg = `${name} is ${a(ts)}, so it can't store ${a(fs)} value.`;
    if (ts === "INTEGER" && fs === "REAL") msg += this.isAS ? " Use INT(x) to get a whole number." : " Use ROUND(Value, 0) or DIV(A, B) to get a whole number.";
    else if (ts === "CHAR" && fs === "STRING") {
      msg = value.k === "lit" && typeof value.value === "string" && value.value.length === 1
        ? `${name} is a CHAR, so write the character in single quotes: '${value.value}'.`
        : `${name} is a CHAR, so it can only store one character${this.isAS ? "" : " in single quotes, such as 'A'"}.`;
    } else if (ts === "STRING" && NUMERIC.has(fs as BasicTypeName) && this.isAS) {
      msg += " Use NUM_TO_STR(x) to turn a number into a string.";
    } else if (NUMERIC.has(ts as BasicTypeName) && TEXT.has(fs as BasicTypeName) && this.isAS) {
      msg += " Use STR_TO_NUM(x) to turn a string into a number.";
    } else if (to.k === "array" && from.k === "array") {
      msg = `${name} is ${ts}, but this is ${fs}. Whole arrays can only be copied when their size and element type match.`;
    }
    this.error(msg, value.pos);
  }

  private checkCond(e: Expr, word: string): void {
    const t = this.checkExpr(e);
    if (t && t !== "BOOLEAN") {
      this.error(`The condition after ${word} must be TRUE or FALSE (a BOOLEAN), but this is ${a(t)}.`, e.pos);
    }
  }

  private checkFor(s: ForStmt): void {
    const ref = this.lookupVar(s.varName, s.varPos);
    let key: string | null = null;
    if (ref) {
      s.ref = ref;
      const sym = ref.sym;
      if (sym.kind === "const") {
        this.error(`${sym.name} is a constant, so it can't be a loop variable.`, s.varPos);
      } else if (sym.type.k !== "basic" || sym.type.name !== "INTEGER") {
        this.error(`A FOR loop variable must be an INTEGER, but ${sym.name} is ${a(typeToString(sym.type))}.`, s.varPos);
      } else if (this.loopVars.includes(ref.key)) {
        this.error(`${sym.name} is already the loop variable of an outer FOR loop. Use a different variable for the inner loop.`, s.varPos);
      } else {
        key = ref.key;
      }
    }
    const intPart = (e: Expr | null, what: string) => {
      if (!e) return;
      const t = this.checkExpr(e);
      if (t && t !== "INTEGER") this.error(`The ${what} of a FOR loop must be an INTEGER, but this is ${a(t)}.`, e.pos);
    };
    intPart(s.start, "start value");
    intPart(s.end, "end value");
    intPart(s.step, "STEP");
    if (s.step && literalNumber(s.step) === 0) this.error("STEP can't be 0, because the loop would never end.", s.step.pos);

    if (key) this.loopVars.push(key);
    this.checkBlock(s.body);
    if (key) this.loopVars.pop();
  }

  private checkCase(s: CaseStmt): void {
    let st: BasicTypeName | null = null;
    if (s.subject) {
      const ref = this.lookupVar(s.subject.name, s.subject.pos);
      if (ref) {
        s.subject.ref = ref;
        if (ref.sym.type.k !== "basic") {
          this.error(`${ref.sym.name} is ${ref.sym.type.k === "array" ? "an array" : "a record"}. CASE OF needs a single variable.`, s.subject.pos);
        } else {
          st = ref.sym.type.name;
          s.subject.type = st;
        }
      }
    }

    const seen: { lo: Value; hi: Value; line: number }[] = [];
    const labelOk = (lit: LitExpr): boolean => {
      lit.type = lit.litType;
      if (!st) return false;
      const lt = lit.litType;
      const ok = st === "INTEGER" ? lt === "INTEGER"
        : st === "REAL" ? NUMERIC.has(lt)
          : TEXT.has(st) ? TEXT.has(lt)
            : lt === st;
      if (!ok) {
        this.error(`${s.subject!.name} is ${a(st)}, so this case value must be ${a(st)} too, not ${a(lt)}.`, lit.pos);
        return false;
      }
      if (st === "CHAR" && lt === "STRING" && String(lit.value).length !== 1) {
        this.error(`${s.subject!.name} is a CHAR, so this case value should be one character in single quotes.`, lit.pos);
        return false;
      }
      return true;
    };

    for (const c of s.clauses) {
      this.line = c.line;
      const label = c.label;
      if (label) {
        let lo: Value | null = null;
        let hi: Value | null = null;
        if (label.k === "value") {
          if (labelOk(label.value)) lo = hi = label.value.value;
        } else {
          const ok1 = labelOk(label.lo);
          const ok2 = labelOk(label.hi);
          if (st === "BOOLEAN") {
            this.error("A range (… TO …) can't be used with BOOLEAN values.", label.lo.pos);
          } else if (ok1 && ok2) {
            lo = label.lo.value;
            hi = label.hi.value;
            if (lo > hi) {
              this.warning(`This range is empty because ${fmt(lo, st)} is bigger than ${fmt(hi, st)}, so it can never match.`, label.lo.pos);
              lo = hi = null;
            }
          }
        }
        if (lo !== null && hi !== null) {
          const cover = seen.find((p) => p.lo <= lo! && hi! <= p.hi);
          if (cover) {
            this.warning(`This case can never run, because the case on line ${cover.line} already matches ${lo === hi ? "this value" : "these values"}.`, c.line);
          } else {
            seen.push({ lo, hi, line: c.line });
          }
        }
      }
      this.checkBlock(c.body);
    }
    if (s.otherwise) this.checkBlock(s.otherwise.body);
  }

  private checkArgs(sub: SubSym, args: Expr[], pos: Pos): void {
    const params = sub.params;
    if (args.length !== params.length) {
      const n = params.length;
      this.error(`${sub.name} needs ${n === 0 ? "no values" : n === 1 ? "1 value" : `${n} values`}, but ${args.length === 0 ? "none were" : args.length === 1 ? "1 was" : `${args.length} were`} given.`, pos);
      args.forEach((x) => this.checkValue(x));
      return;
    }
    args.forEach((arg, i) => {
      const p = params[i];
      if (p.byRef) {
        if (!isPlace(arg)) {
          this.error(`${p.name} is a BYREF parameter, so it needs a variable (which the procedure can change), not a value.`, arg.pos);
          this.checkValue(arg);
          return;
        }
        const t = this.checkPlace(arg);
        const root = rootName(arg)?.ref;
        if (!t || !root) return;
        if (root.sym.kind === "const") {
          this.error(`${root.sym.name} is a constant, so it can't be passed BYREF (the procedure could change it).`, arg.pos);
        } else if (arg.k === "name" && this.loopVars.includes(root.key)) {
          this.error(`${root.sym.name} is the loop variable of the FOR loop it is inside, so it can't be passed BYREF.`, arg.pos);
        } else if (!sameType(t, p.type)) {
          this.error(`${p.name} is a BYREF ${typeToString(p.type)} parameter, so the variable passed must be exactly that type, but ${this.label(arg)} is ${a(typeToString(t))}.`, arg.pos);
        }
        return;
      }
      if (p.type.k === "array" && !this.isAS) {
        if (arg.k !== "name" || arg.paren) {
          this.error(`${p.name} needs a whole array (${typeToString(p.type)}). Pass the array's name.`, arg.pos);
          this.checkValue(arg);
          return;
        }
        const t = this.checkPlace(arg);
        if (t && !sameType(t, p.type)) {
          this.error(`${p.name} needs ${typeToString(p.type)}, but ${arg.name} is ${a(typeToString(t))}. The dimensions, bounds and element type must match.`, arg.pos);
        }
        return;
      }
      const t = this.checkValue(arg);
      if (t && !this.canStore(t, p.type, arg)) {
        const extra = p.type.k === "array" ? " The dimensions, bounds and element type must match." : "";
        this.error(`${p.name} needs ${a(typeToString(p.type))} value, but this is ${a(typeToString(t))}.${extra}`, arg.pos);
      }
    });
  }

  // ---- expressions ----------------------------------------------------------

  /** A variable, array element or record field. Returns its full type. */
  private checkPlace(e: PlaceExpr): SType | null {
    const t = this.typeOfPlace(e);
    if (t) {
      e.stype = t;
      if (t.k === "basic") e.type = t.name;
    }
    return t;
  }

  private typeOfPlace(e: PlaceExpr): SType | null {
    switch (e.k) {
      case "name": {
        const ref = this.lookupVar(e.name, e.pos);
        if (!ref) return null;
        e.ref = ref;
        return ref.sym.type;
      }
      case "index": {
        let ok = true;
        for (const i of e.indices) {
          const t = this.checkExpr(i);
          if (t && t !== "INTEGER") {
            this.error(`An array index must be an INTEGER, but this is ${a(t)}.`, i.pos);
            ok = false;
          }
        }
        e.hasCall = e.indices.some((i) => i.hasCall);
        if (!isPlace(e.base)) {
          this.error("Only an array variable can have an index in [ ].", e.pos);
          return null;
        }
        const bt = this.checkPlace(e.base);
        e.hasCall ||= !!e.base.hasCall;
        if (!bt) return null;
        const name = this.label(e.base);
        if (bt.k !== "array") {
          this.error(`${name} isn't an array, so it can't have an index in [ ].`, e.pos);
          return null;
        }
        const n = bt.dims.length;
        if (e.indices.length !== n) {
          this.error(n === 1
            ? `${name} is a 1D array, so it needs one index, such as ${name}[1].`
            : `${name} is a 2D array, so it needs two indices, such as ${name}[1, 1].`, e.pos);
          return null;
        }
        return ok ? bt.elem : null;
      }
      case "field": {
        if (!isPlace(e.object)) {
          this.error("Only a record variable has fields.", e.pos);
          return null;
        }
        const ot = this.checkPlace(e.object);
        e.hasCall = !!e.object.hasCall;
        if (!ot) return null;
        const name = this.label(e.object);
        if (ot.k !== "record") {
          this.error(`${name} isn't a record, so it has no field called ${e.field}.`, e.fieldPos);
          return null;
        }
        const key = e.field.toUpperCase();
        const f = ot.fields.get(key);
        if (!f) {
          const names = [...ot.fields.values()].map((x) => x.name).join(", ");
          this.error(`${ot.name} has no field called ${e.field}. Its fields are: ${names}.`, e.fieldPos);
          return null;
        }
        this.spelling(e.field, f.name, e.fieldPos);
        e.key = key;
        return f.type;
      }
    }
  }

  /** Any expression, including whole arrays and records. */
  private checkValue(e: Expr): SType | null {
    const t = this.typeOfValue(e);
    if (t) {
      e.stype = t;
      if (t.k === "basic") e.type = t.name;
    }
    return t;
  }

  /** An expression that must be a single value (not a whole array or record). */
  private checkExpr(e: Expr): BasicTypeName | null {
    const t = this.checkValue(e);
    if (!t) return null;
    if (t.k === "basic") return t.name;
    const name = this.label(e);
    if (t.k === "array") {
      this.error(`${name} is an array. Use one element at a time, such as ${name}[1].`, e.pos);
    } else {
      const first = [...t.fields.values()][0]?.name ?? "Field";
      this.error(`${name} is a record. Use one field at a time, such as ${name}.${first}.`, e.pos);
    }
    return null;
  }

  private typeOfValue(e: Expr): SType | null {
    const basic = (name: BasicTypeName | null): SType | null => (name ? { k: "basic", name } : null);
    switch (e.k) {
      case "lit":
        return basic(e.litType);

      case "name": {
        const key = e.name.toUpperCase();
        const isVar = (this.cur?.locals.has(key) ?? false) || this.globals.has(key);
        if (!isVar && this.subs.has(key)) {
          const sub = this.subs.get(key)!;
          this.spelling(e.name, sub.name, e.pos);
          if (sub.kind === "proc") {
            this.error(`${sub.name} is a procedure, so it doesn't give back a value. Run it on its own line with CALL ${sub.name}${this.isAS ? "()" : ""}.`, e.pos);
            return null;
          }
          if (this.isAS) {
            this.error(`At AS Level, a function call needs brackets even with no values: ${sub.name}().`, e.pos);
            return null;
          }
          if (sub.params.length > 0) {
            this.error(`${sub.name} needs ${sub.params.length === 1 ? "1 value" : `${sub.params.length} values`} in brackets: ${sub.name}(…).`, e.pos);
            return null;
          }
          e.sub = sub;
          e.hasCall = true;
          this.recordCall(sub, e.pos);
          return sub.returnType ?? null;
        }
        return this.checkPlace(e);
      }

      case "index": case "field":
        return this.checkPlace(e);

      case "call": {
        const key = e.name.toUpperCase();
        const sub = this.subs.get(key);
        if (!sub) {
          const v = this.cur?.locals.get(key) ?? this.globals.get(key);
          this.error(v
            ? `${e.name} is ${v.type.k === "array" ? "an array, so use square brackets: " + e.name + "[…]" : "a variable, not a function"}.`
            : `There is no function called ${e.name}.`, e.namePos);
          e.args.forEach((x) => this.checkValue(x));
          return null;
        }
        this.spelling(e.name, sub.name, e.namePos);
        if (sub.kind === "proc") {
          this.error(`${sub.name} is a procedure, so it doesn't give back a value. Run it on its own line with CALL ${sub.name}(…).`, e.namePos);
          return null;
        }
        e.sub = sub;
        e.hasCall = true;
        this.checkArgs(sub, e.args, e.namePos);
        this.recordCall(sub, e.namePos);
        return sub.returnType ?? null;
      }

      case "builtin":
        return basic(this.isAS ? this.typeOfBuiltinAS(e.name, e.args, e) : this.typeOfBuiltinO(e.name, e.args, e));

      case "unary": {
        const t = this.checkExpr(e.operand);
        e.hasCall = e.operand.hasCall;
        if (!t) return null;
        if (e.op === "-") {
          if (!NUMERIC.has(t)) {
            this.error(`A minus sign needs a number, but this is ${a(t)}.`, e.pos);
            return null;
          }
          return basic(t);
        }
        if (t !== "BOOLEAN") {
          this.error(`NOT needs a BOOLEAN (TRUE or FALSE), but this is ${a(t)}.`, e.operand.pos);
          return null;
        }
        return basic("BOOLEAN");
      }

      case "binary":
        return basic(this.typeOfBinary(e.op, e.left, e.right, e));
    }
  }

  private typeOfBinary(op: string, left: Expr, right: Expr, e: Expr): BasicTypeName | null {
    const l = this.checkExpr(left);
    const r = this.checkExpr(right);
    e.hasCall = !!(left.hasCall || right.hasCall);
    if (!l || !r) return null;
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "^") {
      if (!NUMERIC.has(l) || !NUMERIC.has(r)) {
        if (op === "+" && (TEXT.has(l) || TEXT.has(r))) {
          this.error(this.isAS
            ? "+ adds numbers. To join strings use &, for example Name & \" is \" & NUM_TO_STR(Age)."
            : "+ can't join text at O Level / IGCSE. To print values on one line, separate them with commas: OUTPUT Name, \" is \", Age.", e.pos);
        } else {
          this.error(`${op} needs numbers on both sides, but this has ${a(l)} and ${a(r)}.`, e.pos);
        }
        return null;
      }
      if (op === "/") return "REAL";
      return l === "INTEGER" && r === "INTEGER" ? "INTEGER" : "REAL";
    }
    if (op === "DIV" || op === "MOD") {
      const bad = l !== "INTEGER" ? { t: l, x: left } : r !== "INTEGER" ? { t: r, x: right } : null;
      if (bad) {
        this.error(`${op} only works with INTEGER values, but this is ${a(bad.t)}.${bad.t === "REAL" ? " Use INT(x) first." : ""}`, bad.x.pos);
        return null;
      }
      return "INTEGER";
    }
    if (op === "&") {
      const bad = !TEXT.has(l) ? { t: l, x: left } : !TEXT.has(r) ? { t: r, x: right } : null;
      if (bad) {
        this.error(`& joins strings and characters, but this is ${a(bad.t)}.${NUMERIC.has(bad.t) ? " Turn it into a string first with NUM_TO_STR(x)." : ""}`, bad.x.pos);
        return null;
      }
      return "STRING";
    }
    if (op === "AND" || op === "OR") {
      if (l !== "BOOLEAN" || r !== "BOOLEAN") {
        const bad = l !== "BOOLEAN" ? left : right;
        this.error(`${op} joins two conditions (BOOLEANs), but this is ${a(l !== "BOOLEAN" ? l : r)}.`, bad.pos);
        return null;
      }
      return "BOOLEAN";
    }
    // Comparisons
    const family = (t: BasicTypeName) => (NUMERIC.has(t) ? "number" : TEXT.has(t) ? "text" : t);
    if (family(l) !== family(r)) {
      this.error(`Can't compare ${a(l)} with ${a(r)}.`, e.pos);
      return null;
    }
    if (l === "BOOLEAN" && op !== "=" && op !== "<>") {
      this.error("BOOLEAN values can only be compared with = or <>.", e.pos);
      return null;
    }
    return "BOOLEAN";
  }

  private builtinArgs(name: string, args: Expr[], e: Expr): BasicTypeName[] | null {
    const types = args.map((x) => this.checkExpr(x));
    e.hasCall = args.some((x) => x.hasCall);
    return types.some((t) => t === null) ? null : (types as BasicTypeName[]);
  }

  private typeOfBuiltinO(name: string, args: Expr[], e: Expr): BasicTypeName | null {
    const ts = this.builtinArgs(name, args, e);
    if (!ts) return name === "RANDOM" ? "REAL" : null;
    const need = (i: number, ok: (t: BasicTypeName) => boolean, what: string): boolean => {
      if (ok(ts[i])) return true;
      this.error(`${name} needs ${what} here, but this is ${a(ts[i])}.`, args[i].pos);
      return false;
    };
    const isText = (t: BasicTypeName) => TEXT.has(t);
    const isInt = (t: BasicTypeName) => t === "INTEGER";
    const isNum = (t: BasicTypeName) => NUMERIC.has(t);
    switch (name) {
      case "LENGTH":
        return need(0, isText, "a STRING") ? "INTEGER" : null;
      case "LCASE": case "UCASE":
        return need(0, isText, "a STRING or CHAR") ? ts[0] : null;
      case "SUBSTRING": {
        const ok = [need(0, isText, "a STRING"), need(1, isInt, "an INTEGER start position"), need(2, isInt, "an INTEGER length")];
        return ok.every(Boolean) ? "STRING" : null;
      }
      case "ROUND": {
        const ok = [need(0, isNum, "a number"), need(1, isInt, "an INTEGER number of decimal places")];
        if (!ok.every(Boolean)) return null;
        const places = this.constNumber(args[1]);
        if (places !== null && places < 0) {
          this.error("The number of decimal places can't be negative.", args[1].pos);
          return null;
        }
        return places === 0 ? "INTEGER" : "REAL";
      }
      case "RANDOM":
        return "REAL";
      case "DIV": case "MOD": {
        const ok = ts.map((t, i) => {
          if (isInt(t)) return true;
          this.error(`${name} only works with INTEGER values, but this is ${a(t)}.${t === "REAL" ? " Use ROUND(Value, 0) first." : ""}`, args[i].pos);
          return false;
        });
        return ok.every(Boolean) ? "INTEGER" : null;
      }
    }
    return null;
  }

  private typeOfBuiltinAS(name: string, args: Expr[], e: Expr): BasicTypeName | null {
    const ts = this.builtinArgs(name, args, e);
    if (!ts) return null;
    /** Each argument either has one of the listed types, or can be stored as `paramType`. */
    const need = (i: number, accepted: BasicTypeName[], what: string): boolean => {
      if (accepted.includes(ts[i]) || accepted.some((p) => this.canStore({ k: "basic", name: ts[i] }, { k: "basic", name: p }, args[i]))) return true;
      this.error(`${name} needs ${what} here, but this is ${a(ts[i])}.${ts[i] === "INTEGER" && accepted.includes("STRING") ? " Use NUM_TO_STR(x) to turn a number into a string." : ""}`, args[i].pos);
      return false;
    };
    const all = (...oks: boolean[]) => oks.every(Boolean);
    const text: BasicTypeName[] = ["STRING", "CHAR"];
    switch (name) {
      case "LENGTH": return need(0, ["STRING"], "a STRING") ? "INTEGER" : null;
      case "LEFT": case "RIGHT":
        return all(need(0, ["STRING"], "a STRING"), need(1, ["INTEGER"], "an INTEGER")) ? "STRING" : null;
      case "MID":
        return all(need(0, ["STRING"], "a STRING"), need(1, ["INTEGER"], "an INTEGER start position"), need(2, ["INTEGER"], "an INTEGER length")) ? "STRING" : null;
      case "LCASE": case "UCASE":
        if (ts[0] === "STRING" && args[0].k !== "lit") {
          this.error(`${name} takes a single CHAR. For a whole STRING use ${name === "LCASE" ? "TO_LOWER" : "TO_UPPER"}(x).`, args[0].pos);
          return null;
        }
        return need(0, ["CHAR"], "a CHAR") ? "CHAR" : null;
      case "TO_UPPER": case "TO_LOWER":
        return need(0, text, "a STRING or CHAR") ? ts[0] : null;
      case "NUM_TO_STR": return need(0, ["INTEGER", "REAL"], "a number") ? "STRING" : null;
      case "STR_TO_NUM": return need(0, text, "a STRING") ? "REAL" : null;
      case "IS_NUM": return need(0, text, "a STRING") ? "BOOLEAN" : null;
      case "ASC": return need(0, ["CHAR"], "a CHAR") ? "INTEGER" : null;
      case "CHR": return need(0, ["INTEGER"], "an INTEGER") ? "CHAR" : null;
      case "INT": return need(0, ["REAL", "INTEGER"], "a number") ? "INTEGER" : null;
      case "RAND": return need(0, ["INTEGER"], "an INTEGER") ? "REAL" : null;
      case "DAY": case "MONTH": case "YEAR": case "DAYINDEX":
        return need(0, ["DATE"], "a DATE") ? "INTEGER" : null;
      case "SETDATE":
        return all(need(0, ["INTEGER"], "an INTEGER day"), need(1, ["INTEGER"], "an INTEGER month"), need(2, ["INTEGER"], "an INTEGER year")) ? "DATE" : null;
      case "TODAY": return "DATE";
      case "EOF": return need(0, text, "a file name (STRING)") ? "BOOLEAN" : null;
    }
    return null;
  }

  /** The value of an integer literal or INTEGER constant, or null if it isn't one. */
  private constNumber(e: Expr): number | null {
    const lit = literalNumber(e);
    if (lit !== null) return lit;
    if (e.k === "name" && e.ref?.sym.kind === "const" && typeof e.ref.sym.constValue === "number") {
      return e.ref.sym.constValue;
    }
    return null;
  }

  // ---- pass 3 ---------------------------------------------------------------

  private checkDefineBeforeUse(): void {
    const reported = new Set<string>();
    const once = (key: string, message: string, pos: Pos) => {
      if (reported.has(key)) return;
      reported.add(key);
      this.error(message, pos);
    };
    for (const call of this.topCalls) {
      const callee = this.subs.get(call.key)!;
      const order: SubSym[] = [];
      const visited = new Set<string>([call.key]);
      const queue = [call.key];
      while (queue.length) {
        const s = this.subs.get(queue.shift()!)!;
        order.push(s);
        for (const k of s.calls) {
          if (!visited.has(k)) {
            visited.add(k);
            queue.push(k);
          }
        }
      }
      for (const s of order) {
        if (s.line > call.line) {
          if (s === callee) {
            once(`${call.line}|${s.key}`, `${s.name} is defined on line ${s.line}, below this line. Procedures and functions must be defined above the code that calls them.`, call.pos);
          } else {
            once(`${call.line}|${s.key}`, `${callee.name} uses ${s.name}, which is only defined on line ${s.line}. Move ${s.name} above line ${call.line}.`, call.pos);
          }
        }
        for (const [gk] of s.globalsUsed) {
          const g = this.globals.get(gk)!;
          if (g.line > call.line) {
            once(`g|${gk}|${call.line}`, `${s.name} uses the global ${g.kind === "const" ? "constant" : "variable"} ${g.name}, but it is only declared on line ${g.line}, after this call. Move its ${g.kind === "const" ? "CONSTANT" : "DECLARE"} above line ${call.line}.`, call.pos);
          }
        }
      }
    }
  }
}

function literalNumber(e: Expr): number | null {
  if (e.k === "lit" && typeof e.value === "number" && e.litType !== "DATE") return e.value;
  if (e.k === "unary" && e.op === "-" && e.operand.k === "lit" && typeof e.operand.value === "number") {
    return -e.operand.value;
  }
  return null;
}

function fmt(v: Value, type: BasicTypeName | null): string {
  if (type === "DATE") return formatDate(v as number);
  return typeof v === "string" ? `"${v}"` : String(v);
}

/** The blocks directly inside a statement (not subroutine bodies). */
export function nestedBlocks(s: Stmt): Stmt[][] {
  switch (s.k) {
    case "if": return s.elseBody ? [s.thenBody, s.elseBody] : [s.thenBody];
    case "case": return [...s.clauses.map((c) => c.body), ...(s.otherwise ? [s.otherwise.body] : [])];
    case "for": case "while": case "repeat": return [s.body];
    default: return [];
  }
}
