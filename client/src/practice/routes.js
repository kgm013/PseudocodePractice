// Page addresses for the practice pages. Topics are addressed by their slug
// (#/practice/ol/variables); their permanent id ("ol-variables") is for data only.

export const levelHref = (levelId) => `#/practice/${levelId}`;
export const topicHref = (levelId, topicSlug) => `#/practice/${levelId}/${topicSlug}`;
