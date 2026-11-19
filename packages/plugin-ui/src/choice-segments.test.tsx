import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChoiceSegments, RadioGroup } from "./choice-segments.tsx";

const options = [
  { id: "server", label: "Your own server" },
  { id: "host", label: "A hosting service" },
];
const look = { slot: "plans", group: "group", option: "option" };

// Each radio's checked state and whether it is the group's tab stop, in order.
const radios = (markup: string) =>
  [...markup.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    checked: tag.includes('aria-checked="true"'),
    stop: tag.includes('tabindex="0"'),
    id: /id="([^"]*)"/.exec(tag)?.[1],
  }));

test("a group with nothing chosen checks nothing and puts its tab stop on the first option", () => {
  expect(
    radios(
      renderToStaticMarkup(
        <RadioGroup
          id="where"
          label="Places to publish"
          options={options}
          choice={null}
          onChoose={() => undefined}
          look={look}
        >
          {(option) => option.label}
        </RadioGroup>,
      ),
    ),
  ).toEqual([
    { checked: false, stop: true, id: "where" },
    { checked: false, stop: false, id: undefined },
  ]);
});

test("a chosen option is checked and is the tab stop", () => {
  expect(
    radios(
      renderToStaticMarkup(
        <ChoiceSegments
          id="where"
          label="Places to publish"
          options={options}
          choice="host"
          onChoose={() => undefined}
        />,
      ),
    ),
  ).toEqual([
    { checked: false, stop: false, id: undefined },
    { checked: true, stop: true, id: "where" },
  ]);
});
