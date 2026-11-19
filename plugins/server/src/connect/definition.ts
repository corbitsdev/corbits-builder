import { defineScreen } from "@corbits-builder/plugin";
import { type } from "arktype";

// The hub saves the server only once Builder's key has signed in to it, so the settled line can say
// it connected.
export const text = {
  title: "Connect your server",
  about:
    "Rent a server with Ubuntu or Debian from any hosting provider, and give them the key below. Using a server you already have? Rebuild it with this key from your provider's control panel, which erases what's on it.",
  settled: "Server connected",
};

export default defineScreen({
  input: type({ "+": "reject" }),
  output: type({ "+": "reject", saved: "true" }),
  // The form needs nothing prepared, but the host shows a screen only once it is prepared.
  prepare: () => ({}),
  describe: {
    says: {
      label: () => text.title,
      chose: () => text.settled,
    },
    summary:
      "Shows the person a key to give their hosting provider when they rent a server, asks for the server's address, checks the key signs in to it, and saves it for the project. The answer is { saved: true }; their server is then where the app is published. For a server already saved it shows the key to give the provider again.",
    when: "The app is to be published to the person's own server and no server is saved yet, they want to use another one, or a publish said the server did not accept Builder's key.",
    unless:
      "A server is saved and they did not ask to change it, and no publish said it refused Builder's key.",
    fields: {},
  },
});
