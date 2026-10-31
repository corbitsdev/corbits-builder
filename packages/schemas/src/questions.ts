import { type } from "arktype";

const QuestionOption = type({
  "+": "reject",
  value: "0 < string <= 64",
  label: "0 < string <= 200",
});

export const Question = type({
  "+": "reject",
  id: /^[a-z0-9][a-z0-9_-]{0,39}$/,
  prompt: "0 < string <= 500",
  kind: "'single' | 'multi'",
  options: QuestionOption.array().atLeastLength(1).atMostLength(8),
  "preselected?": "string[]",
  "allowOther?": "boolean",
});
export type Question = typeof Question.infer;

export const AskQuestions = type({
  "+": "reject",
  questions: Question.array().atLeastLength(1).atMostLength(5),
});
export type AskQuestions = typeof AskQuestions.infer;

export const duplicate = (values: readonly string[]) =>
  values.find((value, index) => values.indexOf(value) !== index);

/** The first rule a schema-valid ask breaks that JSON Schema cannot state, or undefined. */
export function askQuestionsIssue({
  questions,
}: AskQuestions): string | undefined {
  const id = duplicate(questions.map((question) => question.id));
  if (id !== undefined) return "question id " + id + " is used twice";
  for (const question of questions) {
    const values = question.options.map((option) => option.value);
    const value = duplicate(values);
    if (value !== undefined)
      return question.id + " has option value " + value + " twice";
    const preselected = question.preselected ?? [];
    const unknown = preselected.find((value) => !values.includes(value));
    if (unknown !== undefined)
      return (
        question.id + " preselects " + unknown + ", which is not an option"
      );
    if (duplicate(preselected) !== undefined)
      return question.id + " preselects an option twice";
    if (question.kind === "single" && preselected.length > 1)
      return question.id + " is single choice and preselects more than one";
  }
  return undefined;
}

// A question a document leaves for the person, filed with the document version that asks it. Its id
// and suggested answers carry over to an ask_questions card.
const OpenQuestion = type({
  "+": "reject",
  id: Question.get("id"),
  question: Question.get("prompt"),
  whyItBlocks: "0 < string <= 500",
  suggestedAnswers: QuestionOption.get("label").array().atMostLength(8),
});
export const OpenQuestions = OpenQuestion.array().atMostLength(20);
