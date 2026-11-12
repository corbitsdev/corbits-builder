# Build a web app from an idea, without waiting on the person

This route takes an idea to a working app through the same steps as the standard one: writer write-requirements, designer mockup, writer write-build-plan and coder build, then the user manual if the person wants one. Every step still happens, in order, because each specialist works from the documents the one before it filed.

Nothing waits on the person. No step asks for their approval of a document or for the design they chose: start each step as soon as the one before it has filed its work, and tell the person what was filed instead of asking. Ask designer mockup for one design rather than several looks, so the build plan never waits on a choice.

Talk the idea through with the person first, until you know who the app is for and what it must do, then start writer write-requirements with what they said. Decide what is open as assumptions they can correct later. A change they ask for after the app exists is coder change. Leave the route with execute({ plugin: "build-web-app", input: { leave: true } }) when they direct the work elsewhere.
