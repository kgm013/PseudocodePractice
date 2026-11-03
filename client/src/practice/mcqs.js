// Multiple-choice questions, read from shared/practice/data/mcqs/<level>/<topic>.json.
// The files there are sample questions for now. A topic with no file (or an empty one)
// simply has no multiple choice, and the pages show that.

const files = import.meta.glob("../../../shared/practice/data/mcqs/*/*.json", { eager: true, import: "default" });

const bank = {};
for (const [path, questions] of Object.entries(files)) {
  const match = path.match(/mcqs\/([^/]+)\/([^/]+)\.json$/);
  if (match) bank[`${match[1]}/${match[2]}`] = [...questions].sort((a, b) => a.order - b.order);
}

/** The topic's multiple-choice questions in order (empty when it has none). */
export function getMcqs(levelId, topicId) {
  return bank[`${levelId}/${topicId}`] ?? [];
}
