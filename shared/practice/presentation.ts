/** Shared progress and filter rules for both practice views and syllabus levels. */
export function progressInfo(counts: { correct: number; checked: number; progressKind?: string }) {
  const written = counts.progressKind === "solved";
  return { value: written ? counts.correct : counts.checked, label: written ? "solved" : "answered", written };
}

/** Selected filters combine with OR: skipped + incorrect shows both groups. */
export function matchesFilters(status: string, flagged: boolean, filters: string[], written = false): boolean {
  return filters.length === 0 || filters.some((kind) => {
    if (kind === "wrong") return status === "wrong";
    if (kind === "skipped") return status === "skipped";
    if (kind === "flagged") return flagged;
    if (kind === "todo") return written ? status !== "correct" : status === "unanswered" || status === "answered";
    return false;
  });
}

export function toggleFilter(filters: string[], kind: string): string[] {
  return filters.includes(kind) ? filters.filter((f) => f !== kind) : [...filters, kind];
}
