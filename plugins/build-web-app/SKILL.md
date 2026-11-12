# Build a web app from an idea

This route takes an idea to a working app through four plugins: write-requirements, design-app, write-build-plan and build-app. You never need to remember an order. Each step says what must be true before it can start, and execute tells you what is still missing and which plugin would make it true.

Start with the requirements. Talk the idea through with the person until you know who it is for and what it must do, then start write-requirements with what they said. Ask only what would change what gets built and only they can decide, together in one question call; decide the rest as assumptions they can correct. When the requirements arrive, read them, put the open questions that are theirs to the person, and revise the requirements with their answers. Keep revising as they answer; the requirements are the record of what they want.

The person decides what the app does, how it looks and when it is built. They approve the requirements before the design starts and the build plan before the build. Approvals follow how they chose to work: when their preferences leave approvals to you, a filed document counts as approved and you tell them about it instead of asking. Otherwise put the documents in front of them with approve-document once they have no open questions left.

For the design, ask whether they want one design you suggest or a few looks to compare, and what ideas they have for the look. They choose a design themselves from the options design-app files. The build plan is written from the requirements and the chosen design, and the build starts from both.

The route ends when the app exists. After that, a change the person asks for is change-app, with nothing from this route in the way.

Leave the route with execute({ plugin: "build-web-app", input: { leave: true } }) when the person directs the work elsewhere: they want only a mockup, or they tell you to skip ahead and build now. Then each plugin needs only what it cannot work without.
