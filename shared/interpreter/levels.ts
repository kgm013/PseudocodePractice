// What differs between O Level 2210 and AS Level 9618 pseudocode.

export type Level = "O" | "AS";

export const LEVEL_NAMES: Record<Level, string> = { O: "O Level", AS: "AS Level" };

export interface BuiltinSpec {
  arity: number;
  usage: string;
}

export interface Rejected {
  /** Rejected however it is written; otherwise only when written in capitals. */
  anyCase: boolean;
  message: string;
  /** Treat it as this keyword afterwards, to avoid follow-on errors. */
  becomes?: string;
}

export interface LevelSpec {
  level: Level;
  name: string;
  keywords: Set<string>;
  builtins: Record<string, BuiltinSpec>;
  rejected: Record<string, Rejected>;
  basicTypes: Set<string>;
}

const COMMON_REJECTED: Record<string, Rejected> = {
  ELSEIF: { anyCase: true, message: "There is no ELSEIF. Put a new IF inside the ELSE, or use CASE OF.", becomes: "ELSE" },
  ENDFOR: { anyCase: true, message: "A FOR loop ends with NEXT and the loop variable, for example NEXT Count.", becomes: "NEXT" },
  ENDREPEAT: { anyCase: true, message: "A REPEAT loop ends with UNTIL and a condition, for example UNTIL Count = 10." },
  PRINT: { anyCase: true, message: "Use OUTPUT, not PRINT." },
};

// ---- O Level 2210 -----------------------------------------------------------

const O_KEYWORDS = [
  "AND", "ARRAY", "BOOLEAN", "CALL", "CASE", "CHAR", "CLOSEFILE", "CONSTANT", "DECLARE", "DIV", "DO",
  "ELSE", "ENDCASE", "ENDFUNCTION", "ENDIF", "ENDPROCEDURE", "ENDWHILE", "FALSE", "FOR", "FUNCTION",
  "IF", "INPUT", "INTEGER", "LCASE", "LENGTH", "MOD", "NEXT", "NOT", "OF", "OPENFILE", "OR",
  "OTHERWISE", "OUTPUT", "PROCEDURE", "RANDOM", "READ", "READFILE", "REAL", "REPEAT", "RETURN",
  "RETURNS", "ROUND", "STEP", "STRING", "SUBSTRING", "THEN", "TO", "TRUE", "UCASE", "UNTIL", "WHILE",
  "WRITE", "WRITEFILE",
];

const O_BUILTINS: Record<string, BuiltinSpec> = {
  LENGTH: { arity: 1, usage: "LENGTH(Text)" },
  LCASE: { arity: 1, usage: "LCASE(Text)" },
  UCASE: { arity: 1, usage: "UCASE(Text)" },
  SUBSTRING: { arity: 3, usage: "SUBSTRING(Text, Start, Length)" },
  ROUND: { arity: 2, usage: "ROUND(Value, Places)" },
  RANDOM: { arity: 0, usage: "RANDOM()" },
  DIV: { arity: 2, usage: "DIV(A, B)" },
  MOD: { arity: 2, usage: "MOD(A, B)" },
};

const O_REJECTED: Record<string, Rejected> = {
  ...COMMON_REJECTED,
  ELSEIF: { ...COMMON_REJECTED.ELSEIF, message: "There is no ELSEIF at O Level. Put a new IF inside the ELSE, or use CASE OF." },
  BYREF: { anyCase: true, message: "BYREF is A Level only. At O Level every parameter is passed by value, so just write the name and type." },
  BYVAL: { anyCase: true, message: "BYVAL is A Level only. At O Level every parameter is passed by value, so just write the name and type." },
  MID: { anyCase: false, message: "MID is A Level only. At O Level use SUBSTRING(Text, Start, Length)." },
  LEFT: { anyCase: false, message: "LEFT is A Level only. At O Level use SUBSTRING(Text, 1, Length)." },
  RIGHT: { anyCase: false, message: "RIGHT is A Level only. At O Level use SUBSTRING(Text, Start, Length)." },
  INT: { anyCase: false, message: "INT is A Level only. At O Level use ROUND(Value, 0) or DIV(A, B)." },
  RAND: { anyCase: false, message: "RAND is A Level only. At O Level use RANDOM(), which gives a number from 0 to 1." },
  EOF: { anyCase: false, message: "There is no EOF function at O Level. Read a known number of lines instead." },
  APPEND: { anyCase: false, message: "There is no APPEND mode at O Level. Files are opened FOR READ or FOR WRITE." },
  TYPE: { anyCase: false, message: "TYPE (records and enumerated types) is A Level only." },
  CLASS: { anyCase: false, message: "CLASS (object-oriented programming) is A Level only." },
  TO_UPPER: { anyCase: true, message: "TO_UPPER is A Level only. At O Level use UCASE(...)." },
  TO_LOWER: { anyCase: true, message: "TO_LOWER is A Level only. At O Level use LCASE(...)." },
};

// ---- AS Level 9618 ----------------------------------------------------------

const AS_BUILTINS: Record<string, BuiltinSpec> = {
  LENGTH: { arity: 1, usage: "LENGTH(ThisString)" },
  LEFT: { arity: 2, usage: "LEFT(ThisString, x)" },
  RIGHT: { arity: 2, usage: "RIGHT(ThisString, x)" },
  MID: { arity: 3, usage: "MID(ThisString, x, y)" },
  LCASE: { arity: 1, usage: "LCASE(ThisChar)" },
  UCASE: { arity: 1, usage: "UCASE(ThisChar)" },
  TO_UPPER: { arity: 1, usage: "TO_UPPER(x)" },
  TO_LOWER: { arity: 1, usage: "TO_LOWER(x)" },
  NUM_TO_STR: { arity: 1, usage: "NUM_TO_STR(x)" },
  STR_TO_NUM: { arity: 1, usage: "STR_TO_NUM(x)" },
  IS_NUM: { arity: 1, usage: "IS_NUM(ThisString)" },
  ASC: { arity: 1, usage: "ASC(ThisChar)" },
  CHR: { arity: 1, usage: "CHR(x)" },
  INT: { arity: 1, usage: "INT(x)" },
  RAND: { arity: 1, usage: "RAND(x)" },
  DAY: { arity: 1, usage: "DAY(ThisDate)" },
  MONTH: { arity: 1, usage: "MONTH(ThisDate)" },
  YEAR: { arity: 1, usage: "YEAR(ThisDate)" },
  DAYINDEX: { arity: 1, usage: "DAYINDEX(ThisDate)" },
  SETDATE: { arity: 3, usage: "SETDATE(Day, Month, Year)" },
  TODAY: { arity: 0, usage: "TODAY()" },
  EOF: { arity: 1, usage: "EOF(FileName)" },
};

const A2_ONLY = "is A Level only (Paper 4), so it isn't part of AS Level pseudocode.";

const AS_REJECTED: Record<string, Rejected> = {
  ...COMMON_REJECTED,
  SUBSTRING: { anyCase: false, message: "SUBSTRING is O Level. At AS Level use MID(ThisString, x, y)." },
  ROUND: { anyCase: false, message: "There is no ROUND at AS Level. Use INT(x) to cut off the decimal part." },
  RANDOM: { anyCase: false, message: "RANDOM is only a file mode, and random files are A Level only. For a random number use RAND(x)." },
  CLASS: { anyCase: false, message: `CLASS ${A2_ONLY}` },
  ENDCLASS: { anyCase: false, message: `ENDCLASS ${A2_ONLY}` },
  INHERITS: { anyCase: false, message: `INHERITS ${A2_ONLY}` },
  NEW: { anyCase: false, message: `NEW (creating objects) ${A2_ONLY}` },
  PUBLIC: { anyCase: false, message: `PUBLIC ${A2_ONLY}` },
  PRIVATE: { anyCase: false, message: `PRIVATE ${A2_ONLY}` },
  SUPER: { anyCase: false, message: `SUPER ${A2_ONLY}` },
  SEEK: { anyCase: false, message: `SEEK (random files) ${A2_ONLY}` },
  GETRECORD: { anyCase: false, message: `GETRECORD (random files) ${A2_ONLY}` },
  PUTRECORD: { anyCase: false, message: `PUTRECORD (random files) ${A2_ONLY}` },
  DEFINE: { anyCase: false, message: `DEFINE (set types) ${A2_ONLY}` },
  SET: { anyCase: false, message: `SET OF (set types) ${A2_ONLY}` },
};

const AS_KEYWORDS = [
  "AND", "APPEND", "ARRAY", "BOOLEAN", "BYREF", "BYVAL", "CALL", "CASE", "CHAR", "CLASS", "CLOSEFILE",
  "CONSTANT", "DATE", "DECLARE", "DEFINE", "DIV", "ELSE", "ENDCASE", "ENDCLASS", "ENDFUNCTION", "ENDIF",
  "ENDPROCEDURE", "ENDTYPE", "ENDWHILE", "EOF", "FALSE", "FOR", "FUNCTION", "GETRECORD", "INHERITS",
  "INPUT", "INT", "INTEGER", "LCASE", "LENGTH", "MID", "MOD", "NEW", "NEXT", "NOT", "OF", "OPENFILE", "OR",
  "OTHERWISE", "OUTPUT", "PRIVATE", "PROCEDURE", "PUBLIC", "PUTRECORD", "RAND", "RANDOM", "READ",
  "READFILE", "REAL", "REPEAT", "RETURN", "RETURNS", "RIGHT", "SEEK", "SET", "STEP", "STRING", "SUPER",
  "THEN", "TO", "TRUE", "TYPE", "UCASE", "UNTIL", "WHILE", "WRITE", "WRITEFILE",
  // Missing from the rules file's keyword list, but used throughout the guide.
  "IF",
  ...Object.keys(AS_BUILTINS),
];

export const LEVELS: Record<Level, LevelSpec> = {
  O: {
    level: "O",
    name: "O Level",
    keywords: new Set(O_KEYWORDS),
    builtins: O_BUILTINS,
    rejected: O_REJECTED,
    basicTypes: new Set(["INTEGER", "REAL", "CHAR", "STRING", "BOOLEAN"]),
  },
  AS: {
    level: "AS",
    name: "AS Level",
    keywords: new Set(AS_KEYWORDS),
    builtins: AS_BUILTINS,
    rejected: AS_REJECTED,
    basicTypes: new Set(["INTEGER", "REAL", "CHAR", "STRING", "BOOLEAN", "DATE"]),
  },
};
