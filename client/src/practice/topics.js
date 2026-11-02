// The practice levels and their topics, in teaching order.
// Topic ids are used in page addresses (#/practice/ol/variables), so keep them stable.

export const PRACTICE_LEVELS = {
  ol: {
    id: "ol",
    name: "O Level / IGCSE",
    codes: "2210 · 0478",
    interpreterLevel: "O",
    topics: [
      {
        id: "variables",
        title: "Variables",
        summary: "Declare variables and constants, choose a data type and assign values.",
      },
      {
        id: "output",
        title: "Output",
        summary: "Show text and values on screen with `OUTPUT`.",
      },
      {
        id: "input",
        title: "Input",
        summary: "Read values typed by the user with `INPUT` and store them.",
      },
      {
        id: "arithmetic",
        title: "Arithmetic",
        summary: "Calculate with `+` `-` `*` `/` `^`, `DIV`, `MOD` and `ROUND`.",
      },
    ],
  },
  as: {
    id: "as",
    name: "AS Level",
    codes: "9618",
    interpreterLevel: "AS",
    topics: [
      {
        id: "variables",
        title: "Variables",
        summary: "Declare variables and constants, choose a data type (including `DATE`) and assign values.",
      },
      {
        id: "output",
        title: "Output",
        summary: "Show text and values on screen with `OUTPUT`, joining strings with `&`.",
      },
      {
        id: "input",
        title: "Input",
        summary: "Read values typed by the user with `INPUT` and convert them where needed.",
      },
      {
        id: "arithmetic",
        title: "Arithmetic",
        summary: "Calculate with `+` `-` `*` `/`, `DIV`, `MOD` and `INT`.",
      },
    ],
  },
};

export function getLevel(levelId) {
  return PRACTICE_LEVELS[levelId] ?? null;
}

/** The topic plus its position and neighbours, or null if it doesn't exist. */
export function getTopic(levelId, topicId) {
  const level = getLevel(levelId);
  if (!level) return null;
  const index = level.topics.findIndex((t) => t.id === topicId);
  if (index === -1) return null;
  return {
    level,
    topic: level.topics[index],
    number: index + 1,
    total: level.topics.length,
    previous: level.topics[index - 1] ?? null,
    next: level.topics[index + 1] ?? null,
  };
}

export const topicHref = (levelId, topicId) => `#/practice/${levelId}/${topicId}`;
export const levelHref = (levelId) => `#/practice/${levelId}`;
