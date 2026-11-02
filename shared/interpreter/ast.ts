// The program tree built by the parser, plus the extra facts the checker adds.

import type { Level } from "./levels.ts";

export type BasicTypeName = "INTEGER" | "REAL" | "CHAR" | "STRING" | "BOOLEAN" | "DATE";

export interface Pos {
  line: number;
  col: number;
  endCol: number;
}

// ---- Types as written in the source -------------------------------------

export type BoundNode =
  | { k: "num"; value: number; pos: Pos }
  | { k: "name"; name: string; pos: Pos };

export interface DimNode {
  lo: BoundNode;
  hi: BoundNode;
}

export type TypeNode =
  | { k: "basic"; name: BasicTypeName; pos: Pos }
  /** A record type defined with TYPE … ENDTYPE (AS Level). */
  | { k: "named"; name: string; pos: Pos }
  | { k: "array"; dims: DimNode[]; elem: TypeNode; pos: Pos };

// ---- Types the checker works out ---------------------------------------

export interface Dim {
  lo: number;
  hi: number;
}

export interface RecordField {
  name: string;
  type: SType;
}

export type SType =
  | { k: "basic"; name: BasicTypeName }
  | { k: "array"; elem: SType; dims: Dim[] }
  | { k: "record"; name: string; key: string; fields: Map<string, RecordField> };

// ---- Symbols (filled in by the checker) ------------------------------------

export type Value = number | string | boolean;

export interface VarSym {
  kind: "var" | "const" | "param";
  /** Spelling used in the declaration. */
  name: string;
  /** Upper-case key: names are case-insensitive. */
  key: string;
  type: SType;
  line: number;
  scope: "global" | "local";
  constValue?: Value;
  /** AS Level BYREF parameter. */
  byRef?: boolean;
}

export interface SubSym {
  kind: "proc" | "func";
  name: string;
  key: string;
  line: number;
  params: VarSym[];
  returnType?: SType;
  /** Every local: parameters, DECLAREs and CONSTANTs in the body. */
  locals: Map<string, VarSym>;
  node: ProcedureDef | FunctionDef;
  /** Keys of subroutines this one calls directly. */
  calls: Set<string>;
  /** Globals used in the body, with the first line that uses each. */
  globalsUsed: Map<string, number>;
}

export interface VarRef {
  scope: "global" | "local";
  key: string;
  sym: VarSym;
}

// ---- Expressions ---------------------------------------------------------

interface ExprBase {
  pos: Pos;
  /** Written inside its own brackets. */
  paren?: boolean;
  /** Static type when it is a single value (set by the checker). */
  type?: BasicTypeName;
  /** Full static type, including arrays and records (set by the checker). */
  stype?: SType;
  /** Contains a call to a user function (set by the checker). */
  hasCall?: boolean;
}

export interface LitExpr extends ExprBase { k: "lit"; litType: BasicTypeName; value: Value }
export interface NameExpr extends ExprBase { k: "name"; name: string; ref?: VarRef; sub?: SubSym }
/** base[i] or base[i, j]. The base is a name, a field or another index. */
export interface IndexExpr extends ExprBase { k: "index"; base: Expr; indices: Expr[] }
/** object.Field (AS Level records). */
export interface FieldExpr extends ExprBase { k: "field"; object: Expr; field: string; fieldPos: Pos; key?: string }
export interface CallExpr extends ExprBase { k: "call"; name: string; namePos: Pos; args: Expr[]; sub?: SubSym }
export interface BuiltinExpr extends ExprBase { k: "builtin"; name: string; args: Expr[] }
export interface UnaryExpr extends ExprBase { k: "unary"; op: "-" | "NOT"; operand: Expr }
export interface BinaryExpr extends ExprBase { k: "binary"; op: string; left: Expr; right: Expr }

export type Expr = LitExpr | NameExpr | IndexExpr | FieldExpr | CallExpr | BuiltinExpr | UnaryExpr | BinaryExpr;

/** A place a value can be stored: a variable, an array element or a record field. */
export type PlaceExpr = NameExpr | IndexExpr | FieldExpr;

export function isPlace(e: Expr): e is PlaceExpr {
  return !e.paren && (e.k === "name" || e.k === "index" || e.k === "field");
}

/** The variable name a place starts from, e.g. Form for Form[3].YearGroup. */
export function rootName(e: Expr): NameExpr | null {
  if (e.k === "name") return e;
  if (e.k === "index") return rootName(e.base);
  if (e.k === "field") return rootName(e.object);
  return null;
}

export interface Target {
  place: PlaceExpr;
  pos: Pos;
}

export type FileName =
  | { k: "lit"; value: string; pos: Pos }
  | { k: "name"; name: string; pos: Pos; ref?: VarRef };

// ---- Statements ----------------------------------------------------------

interface StmtBase {
  line: number;
  /** Written on a CASE label line, after the label. */
  inline?: boolean;
}

export interface Declaration extends StmtBase { k: "declare"; name: string; namePos: Pos; typeNode: TypeNode }
export interface ConstantDecl extends StmtBase { k: "constant"; name: string; namePos: Pos; value: LitExpr }
export interface Assignment extends StmtBase { k: "assign"; target: Target; value: Expr }
export interface InputStmt extends StmtBase { k: "input"; target: Target }
export interface OutputStmt extends StmtBase { k: "output"; values: Expr[] }
export interface IfStmt extends StmtBase {
  k: "if"; cond: Expr | null;
  thenLine?: number; thenBody: Stmt[];
  elseLine?: number; elseBody: Stmt[] | null;
  endLine?: number;
}
export type CaseLabel =
  | { k: "value"; value: LitExpr }
  | { k: "range"; lo: LitExpr; hi: LitExpr };
export interface CaseClause { line: number; label: CaseLabel | null; body: Stmt[] }
export interface CaseStmt extends StmtBase {
  k: "case"; subject: NameExpr | null;
  clauses: CaseClause[];
  otherwise: { line: number; body: Stmt[] } | null;
  endLine?: number;
}
export interface ForStmt extends StmtBase {
  k: "for"; varName: string; varPos: Pos; ref?: VarRef;
  start: Expr | null; end: Expr | null; step: Expr | null;
  body: Stmt[]; endLine?: number;
}
export interface RepeatStmt extends StmtBase { k: "repeat"; body: Stmt[]; cond: Expr | null; endLine?: number }
export interface WhileStmt extends StmtBase { k: "while"; cond: Expr | null; body: Stmt[]; endLine?: number }
export interface CallStmt extends StmtBase { k: "call"; name: string; namePos: Pos; args: Expr[]; sub?: SubSym }
export interface ReturnStmt extends StmtBase { k: "return"; value: Expr }
export interface OpenFileStmt extends StmtBase { k: "openfile"; file: FileName; mode: "READ" | "WRITE" | "APPEND" }
export interface ReadFileStmt extends StmtBase { k: "readfile"; file: FileName; target: Target }
/** O Level writes a variable (a Target); AS Level writes any value. */
export interface WriteFileStmt extends StmtBase { k: "writefile"; file: FileName; value: Expr }
export interface CloseFileStmt extends StmtBase { k: "closefile"; file: FileName }

export interface Param { name: string; namePos: Pos; typeNode: TypeNode; byRef: boolean; modePos?: Pos }

export interface ProcedureDef extends StmtBase {
  k: "procedure"; name: string; namePos: Pos; params: Param[];
  body: Stmt[]; endLine?: number; sym?: SubSym;
}
export interface FunctionDef extends StmtBase {
  k: "function"; name: string; namePos: Pos; params: Param[]; returnType: TypeNode | null;
  body: Stmt[]; endLine?: number; sym?: SubSym;
}
export interface FieldDecl { name: string; namePos: Pos; typeNode: TypeNode; line: number }
/** TYPE Name … ENDTYPE (AS Level records). */
export interface TypeDef extends StmtBase { k: "typedef"; name: string; namePos: Pos; fields: FieldDecl[]; endLine?: number }

export type Stmt =
  | Declaration | ConstantDecl | Assignment | InputStmt | OutputStmt | IfStmt | CaseStmt
  | ForStmt | RepeatStmt | WhileStmt | CallStmt | ReturnStmt
  | OpenFileStmt | ReadFileStmt | WriteFileStmt | CloseFileStmt
  | ProcedureDef | FunctionDef | TypeDef;

export interface Program {
  level: Level;
  body: Stmt[];
  /** Filled in by the checker. */
  globals?: Map<string, VarSym>;
  subs?: Map<string, SubSym>;
}
