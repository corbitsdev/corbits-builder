/**
 * Third-party work that npm license metadata does not cover: vendored source,
 * binaries fetched at run time, local patches, and bundled fonts. `license` is
 * read from the named LICENSE file; where the repository holds no such file it
 * is null and the link is the only authority.
 */
export type OpenSourceKind = "vendored" | "binary" | "patched";

export interface OpenSourceNotice {
  name: string;
  use: string;
  kind: OpenSourceKind;
  /** SPDX id confirmed from a LICENSE file in this repository, or null. */
  license: string | null;
  link: string;
}

export const openSourceNotices: readonly OpenSourceNotice[] = [
  {
    name: "Interchange",
    use: "The workflow runtime: agents, mail, approvals and the loop that runs them.",
    kind: "vendored",
    license: "LGPL-2.1-only",
    link: "https://github.com/faremeter/interchange/blob/19d89be64de634ea6e0ecfbfa7036d3ced6f8bef/LICENSE",
  },
  {
    name: "@corbits/mcp",
    use: "Connects agents to MCP tools; carries a local patch to its approval floor.",
    kind: "patched",
    license: "LGPL-2.1-only",
    link: "https://github.com/corbitsdev/corbits-mcp",
  },
  {
    name: "Sandbox Runtime",
    use: "Fences the build sandbox's files and network.",
    kind: "binary",
    license: "Apache-2.0",
    link: "https://github.com/anthropics/sandbox-runtime",
  },
  {
    name: "Playwright MCP",
    use: "Lets agents drive a browser.",
    kind: "binary",
    license: "Apache-2.0",
    link: "https://github.com/microsoft/playwright-mcp",
  },
  {
    name: "ripgrep",
    use: "Fast file search for agents, fetched by @vscode/ripgrep (MIT). Used under MIT, elected from its Unlicense or MIT dual license.",
    kind: "binary",
    license: "MIT",
    link: "https://github.com/BurntSushi/ripgrep",
  },
  {
    name: "Chrome for Testing headless shell",
    use: "The browser that checks a built app and takes its pictures.",
    kind: "binary",
    license: null,
    link: "https://googlechromelabs.github.io/chrome-for-testing/",
  },
  {
    name: "Red Hat Display",
    use: "The interface's display typeface.",
    kind: "vendored",
    license: null,
    link: "https://fonts.google.com/specimen/Red+Hat+Display/license",
  },
  {
    name: "Space Mono",
    use: "The interface's monospace typeface.",
    kind: "vendored",
    license: null,
    link: "https://fonts.google.com/specimen/Space+Mono/license",
  },
];
