// Step 4: run the checked program, one statement at a time.
//
// The machine is a generator: it yields the line number before each statement
// (so a debugger can step later) and yields an InputRequest when it needs INPUT.

import { PseudoRuntimeError } from "./diagnostics.ts";
import type { Diagnostic } from "./diagnostics.ts";
import type {
  BasicTypeName, Dim, Expr, FileName, PlaceExpr, Program, SType, Stmt, SubSym, Value, VarRef, VarSym,
} from "./ast.ts";
import { formatDate, fromDayNumber, isValidDate, parseDate, toDayNumber, todayDayNumber } from "./dates.ts";

export interface RunOptions {
  /** Statements (and loop checks) allowed before the program is stopped. */
  stepLimit?: number;
  maxCallDepth?: number;
  maxOutputLines?: number;
  /** Text files the program can read: name → contents. */
  files?: Record<string, string>;
  /** Random number source in [0, 1). Defaults to Math.random. */
  random?: () => number;
  onOutput: (text: string) => void;
  onWarning?: (warning: Diagnostic) => void;
}

export interface InputRequest {
  type: "input";
  line: number;
  name: string;
  valueType: BasicTypeName;
}

export type Yielded = number | InputRequest;

class ArrayValue {
  dims: Dim[];
  data: Slot[];
  constructor(dims: Dim[], data: Slot[]) {
    this.dims = dims;
    this.data = data;
  }
}

class RecordValue {
  fields: Map<string, Slot>;
  constructor(fields: Map<string, Slot>) {
    this.fields = fields;
  }
}

/** What a variable, element or field holds. undefined means "never assigned". */
type Slot = Value | ArrayValue | RecordValue | undefined;

interface Cell {
  value: Slot;
}

type Frame = Map<string, Cell>;

/** Somewhere a value lives: a variable, an array element or a record field. */
interface Loc {
  get(): Slot;
  set(v: Slot): void;
  /** How the place is shown in messages, e.g. Scores[3] or Pupil.LastName. */
  label: string;
  /** The variable it belongs to, so a "never assigned" warning is given once per variable. */
  root: string;
}

interface ReturnSignal {
  value: Slot;
}

type Gen<T> = Generator<Yielded, T, string | undefined>;
type Exec = Gen<ReturnSignal | undefined>;

export const DEFAULT_STEP_LIMIT = 2_000_000;
export const DEFAULT_MAX_CALL_DEPTH = 500;
export const DEFAULT_MAX_OUTPUT_LINES = 10_000;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const NUMBER_TEXT = /^[+-]?\d+(\.\d+)?$/;

export function formatValue(v: Value, type: BasicTypeName): string {
  switch (type) {
    case "BOOLEAN": return v ? "TRUE" : "FALSE";
    case "REAL": return formatReal(v as number);
    case "DATE": return formatDate(v as number);
    default: return String(v);
  }
}

/** REALs always show at least one decimal place (P-IO-1); tiny float noise is hidden. */
export function formatReal(x: number): string {
  const clean = Number(x.toPrecision(15));
  const s = String(clean);
  return /[.eE]/.test(s) || !Number.isFinite(clean) ? s : `${s}.0`;
}

/** ROUND: cut to `places` decimal places, toward zero (policy). */
export function truncateTo(x: number, places: number): number {
  if (places === 0) return Math.trunc(x) || 0;
  const s = String(x);
  if (/e/i.test(s)) {
    const f = 10 ** places;
    return Math.trunc(x * f) / f;
  }
  const [ip, fp = ""] = s.split(".");
  return Number(`${ip}.${fp.slice(0, places) || "0"}`);
}

function makeDefault(t: SType): Slot {
  if (t.k === "basic") return undefined;
  if (t.k === "array") {
    const size = t.dims.reduce((n, d) => n * (d.hi - d.lo + 1), 1);
    const elem = t.elem;
    const data: Slot[] = elem.k === "basic" ? new Array(size).fill(undefined) : Array.from({ length: size }, () => makeDefault(elem));
    return new ArrayValue(t.dims, data);
  }
  const fields = new Map<string, Slot>();
  for (const [key, f] of t.fields) fields.set(key, makeDefault(f.type));
  return new RecordValue(fields);
}

function copyValue(v: Slot): Slot {
  if (v instanceof ArrayValue) return new ArrayValue(v.dims, v.data.map(copyValue));
  if (v instanceof RecordValue) return new RecordValue(new Map([...v.fields].map(([k, x]) => [k, copyValue(x)])));
  return v;
}

export class Machine {
  steps = 0;
  /** Line of the statement being run. */
  line = 0;

  private program: Program;
  private isAS: boolean;
  private stepLimit: number;
  private maxCallDepth: number;
  private maxOutputLines: number;
  private rng: () => number;
  private onOutput: (text: string) => void;
  private onWarning: (w: Diagnostic) => void;

  private globals: Frame = new Map();
  private locals: Frame = new Map();
  private depth = 0;
  private outputLines = 0;
  private warned = new Set<string>();

  private files = new Map<string, string[]>();
  private open = new Map<string, { mode: "READ" | "WRITE" | "APPEND"; pos: number }>();

  constructor(program: Program, opts: RunOptions) {
    this.program = program;
    this.isAS = program.level === "AS";
    this.stepLimit = opts.stepLimit ?? DEFAULT_STEP_LIMIT;
    this.maxCallDepth = opts.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxOutputLines = opts.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;
    this.rng = opts.random ?? Math.random;
    this.onOutput = opts.onOutput;
    this.onWarning = opts.onWarning ?? (() => {});
    for (const [name, text] of Object.entries(opts.files ?? {})) {
      const lines = text.split(/\r\n|\r|\n/);
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      this.files.set(name, lines);
    }
  }

  /** Files as they are now, including anything the program wrote. */
  getFiles(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, lines] of this.files) out[name] = lines.join("\n");
    return out;
  }

  *run(): Exec {
    this.globals = this.makeFrame(this.program.globals!.values());
    yield* this.execBlock(this.program.body);
    for (const name of this.open.keys()) {
      this.warn(`The file "${name}" was still open when the program ended, so it was closed automatically. Use CLOSEFILE "${name}" when you're done with it.`, this.line);
    }
    this.open.clear();
    return undefined;
  }

  // ---- helpers --------------------------------------------------------------

  private fail(message: string, line = this.line): never {
    throw new PseudoRuntimeError(message, line);
  }

  private warn(message: string, line: number): void {
    this.onWarning({ severity: "warning", message, line });
  }

  private tick(line: number): void {
    this.line = line;
    if (++this.steps > this.stepLimit) {
      this.fail(`The program was stopped after ${this.stepLimit.toLocaleString("en-GB")} steps. This usually means a loop that never ends: check that its condition can change.`);
    }
  }

  private makeFrame(syms: Iterable<VarSym>): Frame {
    const frame: Frame = new Map();
    for (const s of syms) frame.set(s.key, { value: s.kind === "const" ? s.constValue : makeDefault(s.type) });
    return frame;
  }

  private cellOf(ref: VarRef): Cell {
    return (ref.scope === "global" ? this.globals : this.locals).get(ref.key)!;
  }

  private randomValue(type: BasicTypeName): Value {
    const r = this.rng;
    switch (type) {
      case "INTEGER": return Math.floor(r() * 1999) - 999;
      case "REAL": return (Math.floor(r() * 199999) - 99999) / 100;
      case "CHAR": return LETTERS[Math.floor(r() * 26)];
      case "STRING": return Array.from({ length: 4 }, () => LETTERS[Math.floor(r() * 52)]).join("");
      case "BOOLEAN": return r() < 0.5;
      case "DATE": return toDayNumber(1, 1, 2000) + Math.floor(r() * 11_000);
    }
  }

  /** Reads a place. A never-assigned value becomes a random one, with a warning. */
  private readLoc(loc: Loc, type: SType | undefined): Slot {
    const v = loc.get();
    if (v !== undefined || !type || type.k !== "basic") return v;
    const r = this.randomValue(type.name);
    loc.set(r);
    if (!this.warned.has(loc.root)) {
      this.warned.add(loc.root);
      this.warn(`${loc.label} was used before it was given a value, so it holds a random value (${formatValue(r, type.name)}).`, this.line);
    }
    return r;
  }

  private nameLoc(ref: VarRef): Loc {
    const cell = this.cellOf(ref);
    return {
      get: () => cell.value,
      set: (v) => { cell.value = v; },
      label: ref.sym.name,
      root: `${ref.scope}|${ref.key}`,
    };
  }

  private elementLoc(base: Loc, idx: number[]): Loc {
    const arr = base.get() as ArrayValue;
    let flat = 0;
    for (let d = 0; d < arr.dims.length; d++) {
      const { lo, hi } = arr.dims[d];
      const i = idx[d];
      if (i < lo || i > hi) {
        const where = arr.dims.length > 1 ? ` (${d === 0 ? "first" : "second"} index)` : "";
        this.fail(`Index ${i} is outside the array ${base.label}${where}, which goes from ${lo} to ${hi}.`);
      }
      flat = flat * (hi - lo + 1) + (i - lo);
    }
    return {
      get: () => arr.data[flat],
      set: (v) => { arr.data[flat] = v; },
      label: `${base.label}[${idx.join(", ")}]`,
      root: base.root,
    };
  }

  private fieldLoc(base: Loc, e: PlaceExpr & { k: "field" }): Loc {
    const rec = base.get() as RecordValue;
    const key = e.key!;
    const objType = e.object.stype as SType & { k: "record" };
    return {
      get: () => rec.fields.get(key),
      set: (v) => { rec.fields.set(key, v); },
      label: `${base.label}.${objType.fields.get(key)!.name}`,
      root: base.root,
    };
  }

  private locatePure(e: PlaceExpr): Loc {
    switch (e.k) {
      case "name": return this.nameLoc(e.ref!);
      case "index": {
        const base = this.locatePure(e.base as PlaceExpr);
        return this.elementLoc(base, e.indices.map((i) => this.evalPure(i) as number));
      }
      case "field": return this.fieldLoc(this.locatePure(e.object as PlaceExpr), e);
    }
  }

  private *locate(e: PlaceExpr): Gen<Loc> {
    if (!e.hasCall) return this.locatePure(e);
    switch (e.k) {
      case "name": return this.nameLoc(e.ref!);
      case "index": {
        const base = yield* this.locate(e.base as PlaceExpr);
        const idx: number[] = [];
        for (const i of e.indices) idx.push((yield* this.evaluate(i)) as number);
        return this.elementLoc(base, idx);
      }
      case "field": return this.fieldLoc(yield* this.locate(e.object as PlaceExpr), e);
    }
  }

  /** Copies arrays and records, and checks values that are only allowed when they fit (AS Level). */
  private coerce(v: Slot, to: SType | undefined): Slot {
    if (!to || to.k !== "basic") return copyValue(v);
    if (to.name === "CHAR" && typeof v === "string" && v.length !== 1) {
      this.fail(`A CHAR holds exactly one character, but this STRING has ${v.length}: "${v}".`);
    }
    if (to.name === "INTEGER" && typeof v === "number" && !Number.isInteger(v)) {
      this.fail(`${formatReal(v)} isn't a whole number, so it can't be stored as an INTEGER.`);
    }
    return v;
  }

  private emit(text: string): void {
    if (++this.outputLines > this.maxOutputLines) {
      this.fail(`The program printed more than ${this.maxOutputLines.toLocaleString("en-GB")} lines, so it was stopped. Is there a loop that never ends?`);
    }
    this.onOutput(text);
  }

  private convertText(raw: string, type: BasicTypeName, name: string, what: string): Value {
    const t = raw.trim();
    switch (type) {
      case "INTEGER":
        if (/^[+-]?\d+$/.test(t) && Number.isSafeInteger(Number(t))) return Number(t);
        return this.fail(`${what} needs a whole number (INTEGER) for ${name}, but got "${raw}".`);
      case "REAL":
        if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number(t);
        return this.fail(`${what} needs a number (REAL) for ${name}, but got "${raw}".`);
      case "CHAR":
        if (raw.length === 1) return raw;
        if (t.length === 1) return t;
        return this.fail(`${what} needs exactly one character (CHAR) for ${name}, but got "${raw}".`);
      case "STRING":
        return raw;
      case "BOOLEAN":
        if (t.toUpperCase() === "TRUE") return true;
        if (t.toUpperCase() === "FALSE") return false;
        return this.fail(`${what} needs TRUE or FALSE (BOOLEAN) for ${name}, but got "${raw}".`);
      case "DATE": {
        const d = parseDate(t);
        if (d !== null) return d;
        return this.fail(`${what} needs a date written DD/MM/YYYY for ${name}, but got "${raw}".`);
      }
    }
  }

  // ---- statements ---------------------------------------------------------

  private *execBlock(stmts: Stmt[]): Exec {
    for (const s of stmts) {
      const r = yield* this.exec(s);
      if (r) return r;
    }
    return undefined;
  }

  private *exec(s: Stmt): Exec {
    if (s.k === "procedure" || s.k === "function" || s.k === "typedef") return undefined;
    this.tick(s.line);
    yield s.line;

    switch (s.k) {
      case "declare": case "constant":
        return undefined;

      case "assign": {
        const v = yield* this.evaluate(s.value);
        const loc = yield* this.locate(s.target.place);
        this.line = s.line;
        loc.set(this.coerce(v, s.target.place.stype));
        return undefined;
      }

      case "input": {
        const place = s.target.place;
        const type = place.type!;
        const loc = yield* this.locate(place);
        const raw = yield { type: "input", line: s.line, name: loc.label, valueType: type };
        this.line = s.line;
        loc.set(this.convertText(raw ?? "", type, loc.label, "INPUT"));
        return undefined;
      }

      case "output": {
        let text = "";
        for (const e of s.values) text += formatValue((yield* this.evaluate(e)) as Value, e.type!);
        this.line = s.line;
        this.emit(text);
        return undefined;
      }

      case "if": {
        const c = yield* this.evaluate(s.cond!);
        return yield* this.execBlock(c ? s.thenBody : s.elseBody ?? []);
      }

      case "case": {
        const v = this.readLoc(this.nameLoc(s.subject!.ref!), s.subject!.ref!.sym.type) as Value;
        for (const c of s.clauses) {
          const l = c.label!;
          const match = l.k === "value" ? v === l.value.value : v >= l.lo.value && v <= l.hi.value;
          if (match) return yield* this.execBlock(c.body);
        }
        if (s.otherwise) return yield* this.execBlock(s.otherwise.body);
        return undefined;
      }

      case "for": {
        const start = (yield* this.evaluate(s.start!)) as number;
        const end = (yield* this.evaluate(s.end!)) as number;
        const step = s.step ? ((yield* this.evaluate(s.step)) as number) : 1;
        this.line = s.line;
        if (step === 0) this.fail("The STEP of this FOR loop is 0, so the loop would never end.");
        const cell = this.cellOf(s.ref!);
        const back = s.endLine ?? s.line;
        let i = start;
        for (; step > 0 ? i <= end : i >= end; i += step) {
          cell.value = i;
          const r = yield* this.execBlock(s.body);
          if (r) return r;
          this.tick(back);
          yield back;
        }
        // After the loop the variable holds the first value past the end.
        cell.value = i;
        return undefined;
      }

      case "repeat": {
        const back = s.endLine ?? s.line;
        for (;;) {
          const r = yield* this.execBlock(s.body);
          if (r) return r;
          this.tick(back);
          yield back;
          if (yield* this.evaluate(s.cond!)) return undefined;
        }
      }

      case "while": {
        for (;;) {
          if (!(yield* this.evaluate(s.cond!))) return undefined;
          const r = yield* this.execBlock(s.body);
          if (r) return r;
          this.tick(s.line);
          yield s.line;
        }
      }

      case "call": {
        const args = yield* this.evalArgs(s.sub!, s.args);
        yield* this.callSub(s.sub!, args, s.line);
        return undefined;
      }

      case "return":
        return { value: yield* this.evaluate(s.value) };

      case "openfile": {
        const name = this.fileName(s.file);
        if (this.open.has(name)) {
          this.fail(`"${name}" is already open. Close it with CLOSEFILE before opening it again.`);
        }
        if (s.mode === "READ") {
          if (!this.files.has(name)) this.fail(`There is no file called "${name}" to read. Check the name (it is case-sensitive) or create the file first.`);
        } else if (s.mode === "WRITE" || !this.files.has(name)) {
          this.files.set(name, []);
        }
        this.open.set(name, { mode: s.mode, pos: 0 });
        return undefined;
      }

      case "readfile": {
        const name = this.fileName(s.file);
        const f = this.open.get(name);
        if (!f) this.fail(`"${name}" isn't open. Use OPENFILE "${name}" FOR READ first.`);
        if (f.mode !== "READ") this.fail(`"${name}" is open FOR ${f.mode}, so it can't be read. Close it and open it FOR READ.`);
        const lines = this.files.get(name)!;
        if (f.pos >= lines.length) {
          this.fail(`There are no more lines to read in "${name}" (it has ${lines.length} line${lines.length === 1 ? "" : "s"}).${this.isAS ? " Check EOF before reading." : ""}`);
        }
        const raw = lines[f.pos++];
        const place = s.target.place;
        const loc = yield* this.locate(place);
        this.line = s.line;
        loc.set(this.isAS ? raw : this.convertText(raw, place.type!, loc.label, "READFILE"));
        return undefined;
      }

      case "writefile": {
        const name = this.fileName(s.file);
        const f = this.open.get(name);
        if (!f) this.fail(`"${name}" isn't open. Use OPENFILE "${name}" FOR WRITE first.`);
        if (f.mode === "READ") this.fail(`"${name}" is open FOR READ, so it can't be written to. Close it and open it FOR WRITE${this.isAS ? " or FOR APPEND" : ""}.`);
        const v = (yield* this.evaluate(s.value)) as Value;
        this.files.get(name)!.push(formatValue(v, s.value.type!));
        return undefined;
      }

      case "closefile": {
        const name = this.fileName(s.file);
        if (!this.open.has(name)) this.fail(`"${name}" isn't open, so it can't be closed.`);
        this.open.delete(name);
        return undefined;
      }
    }
  }

  private fileName(f: FileName): string {
    return f.k === "lit" ? f.value : String(this.readLoc(this.nameLoc(f.ref!), f.ref!.sym.type));
  }

  // ---- subroutines ------------------------------------------------------------

  /** Builds the parameter cells: BYREF ones point at the caller's place, BYVAL ones hold a copy. */
  private *evalArgs(sub: SubSym, args: Expr[]): Gen<Cell[]> {
    const out: Cell[] = [];
    for (let i = 0; i < args.length; i++) {
      const p = sub.params[i];
      const a = args[i];
      if (p.byRef) {
        const loc = yield* this.locate(a as PlaceExpr);
        out.push({
          get value() { return loc.get(); },
          set value(v: Slot) { loc.set(v); },
        });
      } else {
        out.push({ value: this.coerce(yield* this.evaluate(a), p.type) });
      }
    }
    return out;
  }

  private *callSub(sub: SubSym, args: Cell[], callLine: number): Gen<Slot> {
    if (this.depth >= this.maxCallDepth) {
      this.fail(`Too many calls inside calls (more than ${this.maxCallDepth}). This usually means recursion that never reaches its stopping case.`, callLine);
    }
    const frame = this.makeFrame([...sub.locals.values()].filter((s) => s.kind !== "param"));
    sub.params.forEach((p, i) => frame.set(p.key, args[i]));
    const saved = this.locals;
    this.locals = frame;
    this.depth++;
    try {
      const r = yield* this.execBlock(sub.node.body);
      if (sub.kind === "func") {
        if (!r) {
          this.fail(`The function ${sub.name} reached ENDFUNCTION without running RETURN, so it has no value to give back.`, sub.node.endLine ?? sub.line);
        }
        return this.coerce(r.value, sub.returnType);
      }
      return undefined;
    } finally {
      this.locals = saved;
      this.depth--;
    }
  }

  // ---- expressions ----------------------------------------------------------

  /** Evaluates an expression. Only expressions that call a user function need the generator path. */
  private *evaluate(e: Expr): Gen<Slot> {
    if (!e.hasCall) return this.evalPure(e);
    switch (e.k) {
      case "name":
        return yield* this.callSub(e.sub!, [], this.line);
      case "call": {
        const line = this.line;
        const args = yield* this.evalArgs(e.sub!, e.args);
        const v = yield* this.callSub(e.sub!, args, line);
        this.line = line;
        return v;
      }
      case "index": case "field":
        return this.readLoc(yield* this.locate(e), e.stype);
      case "builtin": {
        const vals: Value[] = [];
        for (const a of e.args) vals.push((yield* this.evaluate(a)) as Value);
        return this.builtin(e.name, vals, e);
      }
      case "unary": {
        const v = (yield* this.evaluate(e.operand)) as Value;
        return e.op === "-" ? this.num(-(v as number), e) : !v;
      }
      case "binary": {
        // Both sides are always evaluated (no short-circuit), so an error on
        // the right is reported even when the left already decides the answer.
        const l = (yield* this.evaluate(e.left)) as Value;
        const r = (yield* this.evaluate(e.right)) as Value;
        return this.binary(e.op, l, r, e);
      }
      default:
        return this.evalPure(e);
    }
  }

  private evalPure(e: Expr): Slot {
    switch (e.k) {
      case "lit":
        return e.value;
      case "name":
        return this.readLoc(this.nameLoc(e.ref!), e.stype);
      case "index": case "field":
        return this.readLoc(this.locatePure(e), e.stype);
      case "builtin":
        return this.builtin(e.name, e.args.map((a) => this.evalPure(a) as Value), e);
      case "unary": {
        const v = this.evalPure(e.operand) as Value;
        return e.op === "-" ? this.num(-(v as number), e) : !v;
      }
      case "binary": {
        // Both sides are always evaluated (no short-circuit): in
        // (i <= 10) AND (List[i] <> 0), reading List[11] is an error.
        const l = this.evalPure(e.left) as Value;
        return this.binary(e.op, l, this.evalPure(e.right) as Value, e);
      }
      case "call":
        return this.fail("Internal error: function call in a simple expression.");
    }
  }

  private num(v: number, e: Expr): number {
    if (e.type === "INTEGER") {
      if (!Number.isSafeInteger(v)) this.fail("This whole number is too big for an INTEGER.");
      return v || 0;
    }
    if (!Number.isFinite(v)) this.fail("This number is too big.");
    return v;
  }

  private binary(op: string, l: Value, r: Value, e: Expr): Value {
    switch (op) {
      case "+": return this.num((l as number) + (r as number), e);
      case "-": return this.num((l as number) - (r as number), e);
      case "*": return this.num((l as number) * (r as number), e);
      case "/":
        if (r === 0) this.fail("Division by zero: the number after / is 0.");
        return this.num((l as number) / (r as number), e);
      case "DIV":
        if (r === 0) this.fail("DIV by zero: the number after DIV is 0.");
        return Math.trunc((l as number) / (r as number)) || 0;
      case "MOD":
        if (r === 0) this.fail("MOD by zero: the number after MOD is 0.");
        return (l as number) % (r as number) || 0;
      case "&": return String(l) + String(r);
      case "^": {
        if (e.type === "INTEGER" && (r as number) < 0) {
          this.fail(`With whole numbers, the power can't be negative (${l} ^ ${r}). Use a REAL, such as ${l}.0 ^ (${r}).`);
        }
        const v = Math.pow(l as number, r as number);
        if (Number.isNaN(v)) this.fail("A negative number can't be raised to a fractional power.");
        return this.num(v, e);
      }
      case "=": return l === r;
      case "<>": return l !== r;
      case "<": return l < r;
      case "<=": return l <= r;
      case ">": return l > r;
      case ">=": return l >= r;
      case "AND": return (l as boolean) && (r as boolean);
      case "OR": return (l as boolean) || (r as boolean);
    }
    return this.fail(`Internal error: unknown operator ${op}.`);
  }

  private checkChar(name: string, v: Value): string {
    const s = String(v);
    if (s.length !== 1) this.fail(`${name} needs a single character, but got "${s}" (${s.length} characters).`);
    return s;
  }

  private builtin(name: string, a: Value[], e: Expr): Value {
    return this.isAS ? this.builtinAS(name, a, e) : this.builtinO(name, a, e);
  }

  private builtinO(name: string, a: Value[], e: Expr): Value {
    switch (name) {
      case "LENGTH": return (a[0] as string).length;
      case "LCASE": return (a[0] as string).toLowerCase();
      case "UCASE": return (a[0] as string).toUpperCase();
      case "SUBSTRING": {
        const s = a[0] as string;
        const start = a[1] as number;
        const len = a[2] as number;
        if (start < 1) this.fail(`SUBSTRING's start position must be 1 or more, but it is ${start}. Strings start at position 1.`);
        if (len < 1) this.fail(`SUBSTRING's length must be 1 or more, but it is ${len}.`);
        if (start + len - 1 > s.length) {
          this.fail(`SUBSTRING asked for characters ${start} to ${start + len - 1}, but "${s}" only has ${s.length} character${s.length === 1 ? "" : "s"}.`);
        }
        return s.substr(start - 1, len);
      }
      case "ROUND": {
        const places = a[1] as number;
        if (places < 0) this.fail("ROUND can't use a negative number of decimal places.");
        return truncateTo(a[0] as number, places);
      }
      case "RANDOM":
        // 0 to 1 inclusive, as the syllabus says.
        return Math.floor(this.rng() * (2 ** 53 + 1)) / 2 ** 53;
      case "DIV":
        if (a[1] === 0) this.fail("DIV by zero: the second value is 0.");
        return Math.trunc((a[0] as number) / (a[1] as number)) || 0;
      case "MOD":
        if (a[1] === 0) this.fail("MOD by zero: the second value is 0.");
        return (a[0] as number) % (a[1] as number) || 0;
    }
    return this.fail(`Internal error: unknown function ${name} at ${e.pos.line}.`);
  }

  private builtinAS(name: string, a: Value[], e: Expr): Value {
    const s = () => String(a[0]);
    const count = (n: number) => `${n} character${n === 1 ? "" : "s"}`;
    switch (name) {
      case "LENGTH": return s().length;
      case "LEFT": case "RIGHT": {
        const x = a[1] as number;
        if (x < 0) this.fail(`${name} can't take a negative number of characters (${x}).`);
        if (x > s().length) this.fail(`${name} asked for ${count(x)}, but "${s()}" only has ${count(s().length)}.`);
        return name === "LEFT" ? s().slice(0, x) : s().slice(s().length - x);
      }
      case "MID": {
        const x = a[1] as number;
        const y = a[2] as number;
        if (x < 1) this.fail(`MID's start position must be 1 or more, but it is ${x}. Strings start at position 1.`);
        if (y < 0) this.fail(`MID can't take a negative number of characters (${y}).`);
        if (x + y - 1 > s().length) {
          this.fail(`MID asked for characters ${x} to ${x + y - 1}, but "${s()}" only has ${count(s().length)}.`);
        }
        return s().substr(x - 1, y);
      }
      case "LCASE": {
        const c = this.checkChar(name, a[0]);
        return c >= "A" && c <= "Z" ? c.toLowerCase() : c;
      }
      case "UCASE": {
        const c = this.checkChar(name, a[0]);
        return c >= "a" && c <= "z" ? c.toUpperCase() : c;
      }
      case "TO_UPPER": return s().toUpperCase();
      case "TO_LOWER": return s().toLowerCase();
      case "NUM_TO_STR": return e.k === "builtin" && e.args[0].type === "REAL" ? formatReal(a[0] as number) : String(a[0]);
      case "STR_TO_NUM": {
        const t = s().trim();
        if (!NUMBER_TEXT.test(t)) this.fail(`STR_TO_NUM can't turn "${s()}" into a number. Check it first with IS_NUM.`);
        return Number(t);
      }
      case "IS_NUM": return NUMBER_TEXT.test(s().trim());
      case "ASC": return this.checkChar(name, a[0]).charCodeAt(0);
      case "CHR": {
        const x = a[0] as number;
        if (x < 0 || x > 127) this.fail(`CHR needs an ASCII code from 0 to 127, but got ${x}.`);
        return String.fromCharCode(x);
      }
      case "INT": return Math.trunc(a[0] as number) || 0;
      case "RAND": {
        const x = a[0] as number;
        if (x <= 0) this.fail(`RAND needs a number bigger than 0, but got ${x}.`);
        return this.rng() * x;
      }
      case "DAY": return fromDayNumber(a[0] as number).day;
      case "MONTH": return fromDayNumber(a[0] as number).month;
      case "YEAR": return fromDayNumber(a[0] as number).year;
      case "DAYINDEX": return fromDayNumber(a[0] as number).weekday + 1;
      case "SETDATE": {
        const [d, m, y] = a as number[];
        if (!isValidDate(d, m, y)) this.fail(`SETDATE(${d}, ${m}, ${y}) isn't a real date.`);
        return toDayNumber(d, m, y);
      }
      case "TODAY": return todayDayNumber();
      case "EOF": {
        const file = s();
        const f = this.open.get(file);
        if (!f || f.mode !== "READ") this.fail(`EOF("${file}") only works on a file that is open FOR READ.`);
        return f.pos >= this.files.get(file)!.length;
      }
    }
    return this.fail(`Internal error: unknown function ${name} at ${e.pos.line}.`);
  }
}
