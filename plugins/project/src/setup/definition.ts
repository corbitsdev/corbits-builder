import { defineScreen } from "@corbits-builder/plugin";
import { Input, Output } from "./schema.ts";

export default defineScreen({
  input: Input,
  output: Output,
  // The host draws a screen once it is prepared; this one needs nothing past its input.
  prepare: (input) => input,
  describe: {
    says: { label: (input) => input.title },
    summary:
      "Shows the person, as a checklist under a title, the steps they must take outside Builder before what was built can be used, such as creating an account, registering an app or putting a key in their deployment's settings. Each step can carry a link to open, the name of the setting its value goes in, and a mark that it needs a deployment first. It never takes a value: the card tells the person Builder does not ask for or store these. The person ticks each step as they do it, then answers Done or I'll do this later. The answer is { done, left }, the step numbers from 1 in the order given that they did and that they left; if they write back instead, what they wrote is their answer.",
    when: "Something built needs the person to set up accounts, keys, an app registration or a deployment outside Builder before it can be used, as a specialist's hand-back lists them.",
    unless:
      "It would ask the person for a secret's value, which goes in their own deployment or environment and never to Builder; or Builder can do the step itself.",
    fields: {
      title: {
        about:
          'What is being set up, in one short line, such as "Connect the bot to your workspace".',
      },
      steps: {
        about:
          'The steps in the order the person takes them, each { instruction, detail?, link?, needsDeployment?, setting? }. instruction: what to do, in one line. detail: a sentence or two more, only where the instruction is not enough. link: the https address of the page where they do it. needsDeployment: true when the step needs the app deployed at a public address first, such as entering its address in another service. setting: the NAME of the environment setting the step produces a value for, such as "BOT_TOKEN", never the value; the card tells them to put the value there.',
      },
    },
  },
});
