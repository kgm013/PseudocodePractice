// Step 1: split each line into tokens (grammar section 1).

import type { Diagnostics } from "./diagnostics.ts";
import type { LevelSpec } from "./levels.ts";
import { parseDate } from "./dates.ts";

export type TokenKind = "keyword" | "ident" | "int" | "real" | "char" | "string" | "date" | "op";

export interface Token {
  kind: TokenKind;
  /** keyword: upper-case keyword; op: the symbol (`<-` becomes `←`); literals: their content. */
  value: string;
  /** Exactly what was typed. */
  text: string;
  line: number;
  col: number;
  endCol: number;
  /** A keyword that was not typed in upper case. */
  badCase?: boolean;
}

export interface SourceLine {
  line: number;
  text: string;
  /** Number of leading tabs (only meaningful when indentOk). */
  depth: number;
  indentOk: boolean;
  tokens: Token[];
  hasComment: boolean;
  /** The lexer already reported an error on this line. */
  lexError: boolean;
}

const isLetter = (c: string) => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordChar = (c: string) => isLetter(c) || isDigit(c) || c === "_" || /[À-ɏ]/.test(c);

export function lex(source: string, diags: Diagnostics, spec: LevelSpec): SourceLine[] {
  const rawLines = source.split(/\r\n|\r|\n/);
  return rawLines.map((text, i) => lexLine(text, i + 1, diags, spec));
}

function lexLine(text: string, lineNo: number, diags: Diagnostics, spec: LevelSpec): SourceLine {
  const isAS = spec.level === "AS";
  const result: SourceLine = {
    line: lineNo, text, depth: 0, indentOk: true, tokens: [], hasComment: false, lexError: false,
  };
  const err = (message: string, col: number, endCol: number) => {
    diags.error(message, lineNo, col, endCol);
    result.lexError = true;
  };

  const lead = /^[ \t]*/.exec(text)![0];
  const content = text.slice(lead.length);
  if (content.length > 0) {
    if (lead.includes(" ")) {
      result.indentOk = false;
      const isComment = content.startsWith("//");
      const message = "Indent with tabs only (one tab per level), not spaces.";
      if (isComment) diags.warning(message, lineNo, 1, lead.length + 1);
      else err(message, 1, lead.length + 1);
    } else {
      result.depth = lead.length;
    }
  }

  const tokens = result.tokens;
  const push = (kind: TokenKind, value: string, start: number, end: number, extra?: Partial<Token>) => {
    tokens.push({ kind, value, text: text.slice(start, end), line: lineNo, col: start + 1, endCol: end + 1, ...extra });
  };

  let i = lead.length;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1] ?? "";

    if (c === " " || c === "\t") { i++; continue; }

    if (c === "/" && n === "/") { result.hasComment = true; break; }

    // Words: keywords and identifiers
    if (isLetter(c) || c === "_" || /[À-ɏ]/.test(c)) {
      let j = i;
      while (j < text.length && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      const upper = word.toUpperCase();
      const rejected = spec.rejected[upper];
      if (rejected && (rejected.anyCase || word === upper)) {
        err(rejected.message, i + 1, j + 1);
        if (rejected.becomes) push("keyword", rejected.becomes, i, j);
        else push("ident", word, i, j);
      } else if (!isLetter(word[0])) {
        err(`A name must start with a letter, so "${word}" can't be used.`, i + 1, j + 1);
        push("ident", word, i, j);
      } else if (!isAS && word.includes("_")) {
        err(`Names can only use letters and digits at O Level / IGCSE (no underscore), so "${word}" isn't allowed. Try ${word.split("_").filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("")} instead.`, i + 1, j + 1);
        push("ident", word, i, j);
      } else if (/[^A-Za-z0-9_]/.test(word)) {
        err(`Names can only use the letters A–Z, the digits 0–9${isAS ? " and _" : ""}, so "${word}" isn't allowed.`, i + 1, j + 1);
        push("ident", word, i, j);
      } else if (spec.keywords.has(upper)) {
        push("keyword", upper, i, j, word !== upper ? { badCase: true } : undefined);
      } else {
        push("ident", word, i, j);
      }
      i = j;
      continue;
    }

    // AS Level date literals: DD/MM/YYYY written with no spaces.
    if (isAS && isDigit(c)) {
      const m = /^\d{1,2}\/\d{1,2}\/\d{4}(?![\d.])/.exec(text.slice(i));
      if (m) {
        const end = i + m[0].length;
        if (parseDate(m[0]) === null) err(`${m[0]} isn't a real date. Dates are written DD/MM/YYYY.`, i + 1, end + 1);
        push("date", m[0], i, end);
        i = end;
        continue;
      }
    }

    // Numbers
    if (isDigit(c) || (c === "." && isDigit(n))) {
      let j = i;
      while (j < text.length && isDigit(text[j])) j++;
      let isReal = false;
      if (c === ".") {
        j = i + 1;
        while (j < text.length && isDigit(text[j])) j++;
        err(`A REAL number needs a digit before the decimal point: write 0${text.slice(i, j)}, not ${text.slice(i, j)}.`, i + 1, j + 1);
        isReal = true;
      } else if (text[j] === "." && isDigit(text[j + 1] ?? "")) {
        j++;
        while (j < text.length && isDigit(text[j])) j++;
        isReal = true;
      } else if (text[j] === "." && !isDigit(text[j + 1] ?? "")) {
        err(`A REAL number needs a digit after the decimal point: write ${text.slice(i, j)}.0, not ${text.slice(i, j)}.`, i + 1, j + 2);
        j++;
        isReal = true;
      }
      if (j < text.length && (isLetter(text[j]) || text[j] === "_")) {
        let k = j;
        while (k < text.length && isWordChar(text[k])) k++;
        err(`A name must start with a letter, so "${text.slice(i, k)}" can't be used.`, i + 1, k + 1);
        j = k;
      }
      const raw = text.slice(i, j).replace(/[^0-9.]/g, "");
      push(isReal ? "real" : "int", raw.startsWith(".") ? "0" + raw : raw.endsWith(".") ? raw + "0" : raw, i, j);
      i = j;
      continue;
    }

    // Strings
    if (c === '"' || c === "“" || c === "”") {
      const curly = c !== '"';
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "“" && text[j] !== "”") j++;
      const closed = j < text.length;
      const closer = closed ? text[j] : "";
      if (curly || (closed && closer !== '"')) {
        err('Use straight double quotes " for strings, not curly quotes “ ” (these often come from copying a PDF).', i + 1, (closed ? j + 1 : j) + 1);
      } else if (!closed) {
        err('This string has no closing double quote ".', i + 1, j + 1);
      }
      push("string", text.slice(i + 1, j), i, closed ? j + 1 : j);
      i = closed ? j + 1 : j;
      continue;
    }

    // Characters
    if (c === "'" || c === "‘" || c === "’" || c === "ꞌ") {
      const curly = c !== "'";
      let j = i + 1;
      while (j < text.length && !"'‘’ꞌ".includes(text[j])) j++;
      const closed = j < text.length;
      const value = text.slice(i + 1, j);
      const end = closed ? j + 1 : j;
      if (curly || (closed && text[j] !== "'")) {
        err("Use straight single quotes ' for a CHAR, not curly quotes ‘ ’ (these often come from copying a PDF).", i + 1, end + 1);
      } else if (!closed) {
        err("This CHAR has no closing single quote '.", i + 1, end + 1);
      } else if (value.length === 0) {
        err("A CHAR must hold exactly one character, for example 'A'.", i + 1, end + 1);
      } else if (value.length > 1) {
        err(`A CHAR holds exactly one character. For text, use double quotes: "${value}".`, i + 1, end + 1);
      }
      push("char", value, i, end);
      i = end;
      continue;
    }

    // Symbols
    const two = c + n;
    if (c === "←") { push("op", "←", i, i + 1); i++; continue; }
    if (two === "<-") { push("op", "←", i, i + 2); i += 2; continue; }
    if (two === "<=" || two === ">=" || two === "<>") { push("op", two, i, i + 2); i += 2; continue; }
    if (two === "==") { err("Use a single = to compare values, not ==.", i + 1, i + 3); push("op", "=", i, i + 2); i += 2; continue; }
    if (two === "!=") { err("Use <> for 'not equal to', not !=.", i + 1, i + 3); push("op", "<>", i, i + 2); i += 2; continue; }
    if (two === "**") {
      err(isAS ? "There is no power operator at AS Level. Multiply instead, for example X * X." : "Use ^ for powers, not **.", i + 1, i + 3);
      push("op", isAS ? "*" : "^", i, i + 2); i += 2; continue;
    }
    if (two === "&&") { err("Use AND, not &&.", i + 1, i + 3); push("keyword", "AND", i, i + 2); i += 2; continue; }
    if (two === "||") { err("Use OR, not ||.", i + 1, i + 3); push("keyword", "OR", i, i + 2); i += 2; continue; }
    if (c === "–" || c === "—" || c === "−") {
      err("Use the normal minus sign -, not a dash (this often comes from copying a PDF).", i + 1, i + 2);
      push("op", "-", i, i + 1); i++; continue;
    }
    if (c === "&") {
      if (isAS) { push("op", "&", i, i + 1); i++; continue; }
      err("& is A Level only. O Level / IGCSE has no way to join strings: to print values on one line, separate them with commas, for example OUTPUT Name, \" scored \", Score.", i + 1, i + 2);
      push("op", "+", i, i + 1); i++; continue;
    }
    if (c === "^" && isAS) {
      err("There is no power operator at AS Level (^ is for pointers, which are A Level only). Multiply instead, for example X * X.", i + 1, i + 2);
      push("op", "*", i, i + 1); i++; continue;
    }
    if (c === "." && isAS) { push("op", ".", i, i + 1); i++; continue; }
    if (c === "%") { err(`Use ${isAS ? "A MOD B" : "MOD(A, B)"} for the remainder, not %.`, i + 1, i + 2); push("op", "*", i, i + 1); i++; continue; }
    if ("+-*/^=<>:,[]()".includes(c)) { push("op", c, i, i + 1); i++; continue; }

    err(`The character ${c} isn't used in pseudocode.`, i + 1, i + 2);
    i++;
  }

  return result;
}
