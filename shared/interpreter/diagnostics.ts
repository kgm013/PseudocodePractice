// Errors and warnings found before or while a program runs.

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column where the problem starts (optional: whole line if missing). */
  col?: number;
  /** 1-based column just after the problem. */
  endCol?: number;
}

export class Diagnostics {
  items: Diagnostic[] = [];

  error(message: string, line: number, col?: number, endCol?: number): Diagnostic {
    const d: Diagnostic = { severity: "error", message, line, col, endCol };
    this.items.push(d);
    return d;
  }

  warning(message: string, line: number, col?: number, endCol?: number): Diagnostic {
    const d: Diagnostic = { severity: "warning", message, line, col, endCol };
    this.items.push(d);
    return d;
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  sorted(): Diagnostic[] {
    return [...this.items].sort(
      (a, b) =>
        a.line - b.line ||
        (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) ||
        (a.col ?? 0) - (b.col ?? 0),
    );
  }
}

/** Thrown while running a program. */
export class PseudoRuntimeError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}
