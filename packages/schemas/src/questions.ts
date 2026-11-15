import { type } from "arktype";

// The id and wording rules a question keeps wherever a document records one.
export const Question = type({
  id: /^[a-z0-9][a-z0-9_-]{0,39}$/,
  prompt: "0 < string <= 500",
});

export const duplicate = (values: readonly string[]) =>
  values.find((value, index) => values.indexOf(value) !== index);

// A question a document leaves for the person, filed with the document version that asks it. The
// coordinator puts it to the person with the question tool.
const OpenQuestion = type({
  "+": "reject",
  id: Question.get("id"),
  question: Question.get("prompt"),
  whyItBlocks: "0 < string <= 500",
  suggestedAnswers: type("0 < string <= 200").array().atMostLength(8),
});
export const OpenQuestions = OpenQuestion.array().atMostLength(20);
