import { byScore, words, type Strategy } from "./words.ts";

// One point for each declared trigger word the person used as a whole word.
export const triggers: Strategy = (query, plugins) => {
  const asked = words(query);
  return byScore(
    plugins,
    ({ builder }) =>
      [...words((builder.triggers ?? []).join(" "))].filter((word) =>
        asked.has(word),
      ).length,
  );
};
