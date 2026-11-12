import { isSpecialist } from "../catalog.ts";
import { byScore, words, type Strategy } from "./words.ts";

// Each asked word scores the weight of every field it appears in, a specialist's actions included.
// unless is left out: it says when not to pick.
export const fields: Strategy = (query, plugins) => {
  const asked = words(query);
  return byScore(plugins, (plugin) => {
    const { builder, description } = plugin;
    const actions = isSpecialist(plugin) ? plugin.actions : [];
    const weighted: [number, string[]][] = [
      [3, [builder.handle.replaceAll("-", " ")]],
      [3, builder.groups],
      [3, [builder.when, ...actions.map((action) => action.builder.when)]],
      [3, builder.examples ?? []],
      [1, [description, ...actions.map((action) => action.description)]],
    ];
    let total = 0;
    for (const [weight, texts] of weighted) {
      const field = words(texts.join(" "));
      total += weight * [...asked].filter((word) => field.has(word)).length;
    }
    return total;
  });
};
