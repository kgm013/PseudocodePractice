// CodeMirror support for O Level pseudocode: highlighting, tab indentation,
// live error checking and typing <- as ←.

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, indentService, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { compile } from "@shared/interpreter/index.ts";
import { LEVELS } from "@shared/interpreter/levels.ts";

function pseudocodeLanguage(level) {
  const spec = LEVELS[level];
  const builtins = new Set(Object.keys(spec.builtins));
  const isAS = level === "AS";
  return StreamLanguage.define({
    name: "pseudocode",
    token(stream) {
      if (stream.eatSpace()) return null;
      if (stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^"[^"\n]*"?/) || stream.match(/^'[^'\n]*'?/)) return "string";
      if (isAS && stream.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) return "number";
      if (stream.match(/^\d+(\.\d+)?/)) return "number";
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
        const w = stream.current();
        // Only upper-case keywords are highlighted, so a lower-case one stands out.
        if (w === "TRUE" || w === "FALSE") return "bool";
        if (spec.basicTypes.has(w)) return "typeName";
        if (builtins.has(w)) return "builtin";
        if (spec.keywords.has(w)) return "keyword";
        return "variableName";
      }
      if (stream.match(/^(←|<-|<>|<=|>=|[-+*/^=<>&])/)) return "operator";
      stream.next();
      return null;
    },
    tokenTable: {
      builtin: tags.standard(tags.variableName),
    },
  });
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#1d4ed8", fontWeight: "600" },
  { tag: tags.typeName, color: "#0f766e", fontWeight: "600" },
  { tag: tags.bool, color: "#b45309", fontWeight: "600" },
  { tag: tags.standard(tags.variableName), color: "#7c3aed" },
  { tag: tags.string, color: "#b91c1c" },
  { tag: tags.number, color: "#b45309" },
  { tag: tags.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.operator, color: "#334155" },
]);

// Enter keeps the indentation, and adds a tab after a line that opens a block.
const OPENERS = /^(IF|THEN|ELSE|WHILE|FOR|REPEAT|PROCEDURE|FUNCTION|CASE|TYPE)\b/;
const smartIndent = indentService.of((cx, pos) => {
  const line = cx.lineAt(pos, -1);
  const before = line.text.slice(0, Math.max(0, pos - line.from));
  const lead = /^[\t ]*/.exec(before)[0];
  let levels = 0;
  for (const ch of lead) levels += ch === "\t" ? 1 : 0.25;
  levels = Math.floor(levels);
  if (OPENERS.test(before.trim())) levels += 1;
  return levels * cx.unit;
});

/** Replaces <- with ← as you type or paste (but not inside strings or comments). */
const arrowInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input")) return tr;
  const changes = [];
  const doc = tr.newDoc;
  const touched = new Set();
  tr.changes.iterChangedRanges((_fA, _tA, fromB, toB) => {
    const first = doc.lineAt(fromB).number;
    const last = doc.lineAt(toB).number;
    for (let n = first; n <= last; n++) touched.add(n);
  });
  for (const n of touched) {
    const line = doc.line(n);
    const text = line.text;
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "/" && text[i + 1] === "/") {
        break;
      } else if (c === "<" && text[i + 1] === "-") {
        changes.push({ from: line.from + i, to: line.from + i + 2, insert: "←" });
        i++;
      }
    }
  }
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});

// ---- live checking -----------------------------------------------------------

export function toEditorDiagnostic(state, d) {
  const n = Math.min(Math.max(d.line, 1), state.doc.lines);
  const line = state.doc.line(n);
  let from = line.from;
  let to = line.to;
  if (d.col) {
    from = Math.min(line.from + d.col - 1, line.to);
    to = d.endCol ? Math.min(line.from + d.endCol - 1, line.to) : line.to;
  }
  if (to < from) to = from;
  return { from, to, severity: d.severity, message: d.message };
}

function pseudoLinter(level, onDiagnostics) {
  return linter(
    (view) => {
      const { diagnostics } = compile(view.state.doc.toString(), level);
      onDiagnostics?.(diagnostics);
      return diagnostics.map((d) => toEditorDiagnostic(view.state, d));
    },
    { delay: 300 },
  );
}

// ---- highlighting the line of a runtime error ----------------------------

export const setErrorLine = StateEffect.define();

const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = tr.docChanged ? Decoration.none : deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        next = e.value == null || e.value < 1 || e.value > tr.state.doc.lines
          ? Decoration.none
          : Decoration.set([Decoration.line({ class: "cm-runtime-error-line" }).range(tr.state.doc.line(e.value).from)]);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { fontSize: "15px", backgroundColor: "#ffffff", height: "100%" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "#f8fafc", color: "#94a3b8", borderRight: "1px solid #e2e8f0" },
  ".cm-activeLine": { backgroundColor: "#f1f5ff" },
  ".cm-activeLineGutter": { backgroundColor: "#e8eefc", color: "#334155" },
  ".cm-runtime-error-line": { backgroundColor: "#fde8e8" },
  // Show each tab as a faint arrow, like the → in the grammar's examples.
  ".cm-highlightTab": {
    backgroundImage: "none",
    position: "relative",
  },
  ".cm-highlightTab::before": {
    content: '"→"',
    position: "absolute",
    left: "2px",
    color: "#cbd5e1",
  },
  // Spaces aren't marked: indenting with spaces is already underlined as an error.
  ".cm-highlightSpace": { backgroundImage: "none" },
  "&.cm-focused": { outline: "none" },
});

export function pseudocodeExtensions({ level = "O", onDiagnostics } = {}) {
  return [
    pseudocodeLanguage(level),
    syntaxHighlighting(highlightStyle),
    indentUnit.of("\t"),
    EditorState.tabSize.of(4),
    smartIndent,
    arrowInput,
    pseudoLinter(level, onDiagnostics),
    lintGutter(),
    errorLineField,
    theme,
  ];
}
