import { type } from "arktype";
import { duplicate, Question } from "./questions.ts";

const point = type("0 < string <= 160");

// One way to build the app, as the approaches document compares it side by side.
export const Approach = type({
  "+": "reject",
  id: Question.get("id"),
  name: "0 < string <= 80",
  summary: "0 < string <= 400",
  bestFor: "0 < string <= 200",
  pros: point.array().atLeastLength(1).atMostLength(6),
  cons: point.array().atLeastLength(1).atMostLength(6),
  effort: "'low' | 'medium' | 'high'",
  risks: point.array().atMostLength(5),
});
export type Approach = typeof Approach.infer;

// The approaches an approaches document version compares, filed with that version.
export const ApproachesMeta = type({
  "+": "reject",
  approaches: Approach.array().atLeastLength(2).atMostLength(4),
  "recommended?": Approach.get("id"),
});
export type ApproachesMeta = typeof ApproachesMeta.infer;

/** The first rule a schema-valid comparison breaks that JSON Schema cannot state, or undefined. */
export function approachesIssue({
  approaches,
  recommended,
}: ApproachesMeta): { path: string; message: string } | undefined {
  const ids = approaches.map((approach) => approach.id);
  if (duplicate(ids) !== undefined)
    return {
      path: "approaches.approaches",
      message: "give each approach a unique id",
    };
  if (recommended !== undefined && !ids.includes(recommended))
    return {
      path: "approaches.recommended",
      message: "name one of the approach ids",
    };
  return undefined;
}
