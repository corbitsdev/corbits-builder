import { type } from "arktype";
import { defineValue } from "@corbits-builder/plugin";

export const LANGUAGE = defineValue(
  "stack.language",
  type("string"),
  "The programming language the project's code is written in, such as TypeScript.",
);

export const STARTER = defineValue(
  "stack.starter",
  type("string"),
  "The starter the project's code started from, when it started from one: web-app for a web app with a browser client and a server, bare for a TypeScript project on Bun that is not a web app. Builder saves it, with the starter's checks as stack.checks, how it starts as stack.run and how it runs in production as stack.production, when a first build names a starter, and writes the starter's files as the project's first code before the coder starts; code that started from an empty project has none.",
);

export const CHECKS = defineValue(
  "stack.checks",
  type("string"),
  "The commands, in order, that prove the project's saved code installs, builds and passes its tests, one per line.",
);

export const RUN = defineValue(
  "stack.run",
  type("unknown"),
  'How the project\'s program starts so a person can open it in a browser, as { "command": the command that starts it, "port": the environment variable naming the port it answers on, "waitFor": a line it prints once it is ready, if any, "extraPorts": any other variables it needs a free port in }. A project without one serves nothing to open.',
);

export const PRODUCTION = defineValue(
  "stack.production",
  type("unknown"),
  'How the project\'s program runs where people use it, as { "install": the command that installs its dependencies, "build": the command that builds it, "start": the command that starts it, "port": the environment variable naming the port it answers on, "data": the folders, from the project\'s root, that hold what people entered and must survive from one release to the next }. A project without one says nothing about how to publish it.',
);

export default [LANGUAGE, STARTER, CHECKS, RUN, PRODUCTION];
