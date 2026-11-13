import { expect, test } from "bun:test";
import { INPUT_SCHEMAS } from "./coordinator.ts";

// The path of every property, at any depth, that the model would read without a description.
function undescribed(node: unknown, path: string): string[] {
  if (Array.isArray(node))
    return node.flatMap((each) => undescribed(each, path));
  if (typeof node !== "object" || node === null) return [];
  const nested = [
    ...undescribed("items" in node ? node.items : undefined, path),
    ...undescribed("anyOf" in node ? node.anyOf : undefined, path),
  ];
  if (!("properties" in node)) return nested;
  const { properties } = node;
  if (typeof properties !== "object" || properties === null) return nested;
  return [
    ...nested,
    ...Object.entries(properties).flatMap(([name, property]) => {
      const at = `${path}.${name}`;
      const described =
        typeof property === "object" &&
        property !== null &&
        "description" in property &&
        typeof property.description === "string" &&
        property.description.trim() !== "";
      return [...(described ? [] : [at]), ...undescribed(property, at)];
    }),
  ];
}

test("every field of the coordinator's tools, a plan step's included, is described in the schema the model reads", () => {
  for (const [tool, schema] of Object.entries(INPUT_SCHEMAS))
    expect(undescribed(schema, tool)).toEqual([]);
});
