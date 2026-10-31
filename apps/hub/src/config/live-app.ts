// What the person reads about the app when the hub cannot show it.
export const liveAppWording = {
  signIn: "Sign in to Builder with access to this project to use its app.",
  unreachable:
    "The app is not answering. The Live Preview tab in Builder says why.",
  partStopped: "The app's server stopped.",
  stopped: "The app stopped.",
  commandFailed: (command: string) => `\`${command}\` failed.`,
  hostExited: (code: number) =>
    `The process running the app exited with code ${String(code)}.`,
};
