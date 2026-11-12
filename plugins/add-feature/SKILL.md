# Add a feature to an existing app

This route adds a feature to an app that exists through three plugin actions: writer write-requirements, writer write-build-plan and coder change. It is advice about the order, not a gate. Each step lists what the route suggests having first; when that is missing, execute still starts the step and its result says what the route suggested and why. Only the person's go-ahead holds a step back: while they decide approvals themselves, a step that asks for their approval of a document waits for it.

Use it when the feature or change is big enough that the requirements and the build plan should be updated before the coder touches the app, so what was already right does not regress. A small change that is stated exactly, such as a font, a colour, a label or a bug fix, needs none of that: start coder change directly.

Start with the requirements. Talk the feature through with the person until you know what it must do and who it is for, then start writer write-requirements with what they said. When the app was imported and has no documents, the requirements are written first from what the app already does plus the feature. Ask only what would change what gets built and only they can decide, together in one question call; decide the rest as assumptions they can correct. When the requirements arrive, put the open questions that are theirs to the person and revise with their answers.

Then revise the build plan with writer write-build-plan once the requirements are approved, and start coder change once the build plan is approved. Approvals follow how the person chose to work: when their preferences leave approvals to you, a filed document counts as approved and you tell them about it instead of asking. Otherwise put the documents in front of them with the writer's approve screen, question({ plugin: "writer", action: "approve", input: { kinds } }), once they have no open questions left; their answer on it records the approval.

When the feature changes how the app looks, run designer mockup and then designer review before the build plan, and write the build plan from the design the person chose.

The route ends when the change is built. After that, a further small change is coder change, with nothing from this route in the way. Leave the route with execute({ plugin: "add-feature", input: { leave: true } }) when the person directs the work elsewhere, or when the change turns out to be small and exact.
