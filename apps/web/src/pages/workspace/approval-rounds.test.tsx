import { beforeAll, describe, expect, mock, test } from "bun:test";
import React, { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { ThemeProvider } from "@corbits/react-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import type {
  ApprovalRound,
  RecordReviewerDecision,
  StartApprovalRound,
} from "@corbits-builder/schemas/approval-round";
import * as actualArtifacts from "../../api/artifacts.ts";
import * as actualConversation from "../../api/conversation.ts";
import { WhatsNewDialog } from "../../App.view.tsx";
import { wording } from "../../config.ts";
import { queryClient } from "../../queries/client.ts";
import { Settings } from "../settings/settings.tsx";
import { WorkspaceApprovals } from "../settings/workspace-approvals.tsx";
import {
  readWorkspaceReviewers,
  writeWorkspaceReviewers,
} from "../../workspace-approvals-setting.ts";

const realArtifacts = { ...actualArtifacts };
const realConversation = { ...actualConversation };

mock.module("@corbits/react-ui/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) => (open === true ? <div data-slot="dialog-root">{children}</div> : null),
  DialogContent: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <div
      role="dialog"
      data-slot="dialog-content"
      className={className}
      {...props}
    >
      {children}
    </div>
  ),
  DialogHeader: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <div data-slot="dialog-header" className={className} {...props}>
      {children}
    </div>
  ),
  DialogBody: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <div data-slot="dialog-body" className={className} {...props}>
      {children}
    </div>
  ),
  DialogFooter: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <div data-slot="dialog-footer" className={className} {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <h2 data-slot="dialog-title" className={className} {...props}>
      {children}
    </h2>
  ),
  DialogDescription: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <p data-slot="dialog-description" className={className} {...props}>
      {children}
    </p>
  ),
  DialogFieldLabel: ({
    className,
    children,
    ...props
  }: Record<string, unknown> & {
    className?: string;
    children?: ReactNode;
  }) => (
    <label data-slot="dialog-field-label" className={className} {...props}>
      {children}
    </label>
  ),
}));

let startRoundCalls: { projectId: string; body: StartApprovalRound }[] = [];
let sendMessageCalls: { projectId: string; content: string }[] = [];
let recordDecisionCalls: {
  projectId: string;
  roundId: string;
  reviewerId: string;
  body: RecordReviewerDecision;
}[] = [];

mock.module("../../api/conversation.ts", () => ({
  ...realConversation,
  sendMessage: async (projectId: string, content: string): Promise<void> => {
    sendMessageCalls.push({ projectId, content });
  },
}));

mock.module("../../api/artifacts.ts", () => ({
  ...realArtifacts,
  startApprovalRound: async (
    projectId: string,
    body: StartApprovalRound,
  ): Promise<ApprovalRound> => {
    startRoundCalls.push({ projectId, body });
    return {
      roundId: "rnd_created",
      projectId,
      artifactId: "art_pkg_1",
      packageVersion: body.packageVersion,
      packageSha256: "b".repeat(64),
      expiry: body.expiry,
      status: "open",
      createdAt: "2026-04-02T12:00:00.000Z",
      expiresAt: "2026-04-09T12:00:00.000Z",
      reviewers: body.reviewers.map((rev, idx) => ({
        id: `rev_new_${String(idx + 1)}`,
        name: rev.name,
        persona: rev.persona,
        ...(rev.email === undefined ? {} : { email: rev.email }),
        ...(rev.goal === undefined ? {} : { goal: rev.goal }),
        state: "sent",
      })),
      triage: [],
    };
  },
  downloadApprovalPackageZip: async (): Promise<File> =>
    new File(["zip"], "package.zip", { type: "application/zip" }),
  recordReviewerDecision: async (
    projectId: string,
    roundId: string,
    reviewerId: string,
    body: RecordReviewerDecision,
  ): Promise<ApprovalRound> => {
    recordDecisionCalls.push({ projectId, roundId, reviewerId, body });
    return {
      ...openRound,
      roundId,
      projectId,
      reviewers: openRound.reviewers.map((rev) =>
        rev.id === reviewerId
          ? {
              ...rev,
              ...(body.name === undefined ? {} : { name: body.name }),
              ...(body.persona === undefined ? {} : { persona: body.persona }),
              ...(body.goal === undefined ? {} : { goal: body.goal }),
              state: body.outcome === undefined ? rev.state : "decided",
              ...(body.outcome === undefined
                ? {}
                : {
                    decision: {
                      outcome: body.outcome,
                      ...(body.note === undefined ? {} : { note: body.note }),
                      slideNotes: [],
                      decidedAt: "2026-04-03T10:00:00.000Z",
                    },
                  }),
            }
          : rev,
      ),
    };
  },
  listApprovalRounds: async () => ({ rounds: [openRound] }),
  settleApprovalRound: async () => ({ ...openRound, status: "settled" }),
  triageReviewerFeedback: async () => openRound,
}));

const { ApprovalRoundsPanel } = await import("./approval-rounds.tsx");
const { SharePackageDialog } = await import("./share-package.tsx");
const { SlidesView } = await import("./approval-package-preview.tsx");

const openRound: ApprovalRound = {
  roundId: "rnd_1",
  projectId: "proj_1",
  artifactId: "art_pkg_1",
  packageVersion: 1,
  packageSha256: "a".repeat(64),
  expiry: "7d",
  status: "open",
  createdAt: "2026-04-01T12:00:00.000Z",
  expiresAt: "2026-04-08T12:00:00.000Z",
  reviewers: [
    {
      id: "rev_1",
      name: "Dana Reviewer",
      persona: "Finance VP",
      email: "dana@example.com",
      state: "decided",
      decision: {
        outcome: "request_changes",
        note: "Clarify Q3 staffing assumptions.",
        slideNotes: [],
        decidedAt: "2026-04-02T09:00:00.000Z",
      },
    },
    {
      id: "rev_2",
      name: "Eli Security",
      persona: "Security Lead",
      state: "sent",
    },
  ],
  triage: [
    {
      itemId: "trg_1",
      roundId: "rnd_1",
      reviewerId: "rev_1",
      reviewerName: "Dana Reviewer",
      persona: "Finance VP",
      text: "Clarify Q3 staffing assumptions.",
      status: "pending",
    },
  ],
};

const sampleBundle: ApprovalPackageBundle = {
  manifest: {
    audience: "Executive steering committee",
    decisionNeeded: "Approve Phase 1 rollout",
    tone: "Executive",
    length: "2 slides",
    sources: [
      {
        artifactId: "11111111-1111-4111-8111-111111111111",
        kind: "problem_brief",
        title: "Customer Portal Brief",
        version: 2,
        sha256: "abcdef0123456789".repeat(4),
      },
    ],
  },
  deck: {
    theme: {
      colors: {
        primary: "#1e293b",
        secondary: "#334155",
        accent: "#2563eb",
        background: "#ffffff",
        text: "#0f172a",
        muted: "#64748b",
      },
      fonts: { heading: "Inter", body: "Inter" },
    },
    slides: [
      {
        layout: "title",
        title: "Customer Portal Approval Deck",
        subtitle: "Phase 1 scope and rollout plan",
      },
    ],
  },
  pptxBase64: Buffer.from("fake-pptx").toString("base64"),
  pdfBase64: Buffer.from("%PDF-1.4 fake-pdf").toString("base64"),
};

type EvaluatedElement = {
  type: string;
  props: Record<string, unknown>;
};

function createStatefulHarness(renderRoot: () => ReactNode) {
  const states = new Map<string, unknown[]>();
  const refs = new Map<string, { current: unknown }[]>();
  const contexts = new Map<object, unknown>();
  let currentPath = "";
  let stateIndex = 0;
  let refIndex = 0;

  const reactInternals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
        H: unknown;
      };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  const dispatcher = {
    useState<T>(
      initial: T | (() => T),
    ): [T, (next: T | ((prev: T) => T)) => void] {
      const path = currentPath;
      const idx = stateIndex++;
      let list = states.get(path);
      if (list === undefined) {
        list = [];
        states.set(path, list);
      }
      if (idx >= list.length) {
        list[idx] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const value = list[idx] as T;
      const setState = (next: T | ((prev: T) => T)) => {
        const target = states.get(path);
        if (target === undefined) return;
        const prev = target[idx] as T;
        target[idx] =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      };
      return [value, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const path = currentPath;
      const idx = refIndex++;
      let list = refs.get(path);
      if (list === undefined) {
        list = [];
        refs.set(path, list);
      }
      if (idx >= list.length) {
        list[idx] = { current: initial };
      }
      return list[idx] as { current: T };
    },
    useEffect() {},
    useLayoutEffect() {},
    useInsertionEffect() {},
    useCallback<T extends (...args: never[]) => unknown>(cb: T): T {
      return cb;
    },
    useMemo<T>(factory: () => T): T {
      return factory();
    },
    useContext(ctx: { _currentValue: unknown }): unknown {
      if (contexts.has(ctx)) {
        return contexts.get(ctx);
      }
      return ctx._currentValue;
    },
    useSyncExternalStore<T>(
      _subscribe: () => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      return getServerSnapshot !== undefined
        ? getServerSnapshot()
        : getSnapshot();
    },
    useId(): string {
      return "test-id";
    },
  };

  function evaluateNode(node: ReactNode, path: string): ReactNode {
    if (
      node === null ||
      node === undefined ||
      typeof node === "boolean" ||
      typeof node === "string" ||
      typeof node === "number"
    ) {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((child, idx) =>
        evaluateNode(child as ReactNode, `${path}[${String(idx)}]`),
      );
    }
    if (!isValidElement(node)) {
      return node;
    }
    const element = node as unknown as {
      type: unknown;
      key: string | null;
      props: Record<string, unknown>;
    };
    const keyPart = element.key !== null ? `:${String(element.key)}` : "";
    if (element.type === Symbol.for("react.fragment")) {
      return evaluateNode(
        element.props["children"] as ReactNode,
        `${path}/frag${keyPart}`,
      );
    }
    if (typeof element.type === "function") {
      const fn = element.type as (props: Record<string, unknown>) => ReactNode;
      const nextPath = `${path}/${fn.name || "Component"}${keyPart}`;
      const prevPath = currentPath;
      const prevStateIdx = stateIndex;
      const prevRefIdx = refIndex;
      currentPath = nextPath;
      stateIndex = 0;
      refIndex = 0;
      try {
        const rendered = fn(element.props);
        return evaluateNode(rendered, nextPath);
      } finally {
        currentPath = prevPath;
        stateIndex = prevStateIdx;
        refIndex = prevRefIdx;
      }
    }
    if (typeof element.type === "object" && element.type !== null) {
      const objType = element.type as {
        $$typeof?: symbol;
        render?: (props: Record<string, unknown>, ref: unknown) => ReactNode;
        type?: unknown;
        _currentValue?: unknown;
      };
      if (
        objType.$$typeof === Symbol.for("react.forward_ref") &&
        typeof objType.render === "function"
      ) {
        const nextPath = `${path}/ForwardRef${keyPart}`;
        const prevPath = currentPath;
        const prevStateIdx = stateIndex;
        const prevRefIdx = refIndex;
        currentPath = nextPath;
        stateIndex = 0;
        refIndex = 0;
        try {
          const rendered = objType.render(
            element.props,
            element.props["ref"] ?? null,
          );
          return evaluateNode(rendered, nextPath);
        } finally {
          currentPath = prevPath;
          stateIndex = prevStateIdx;
          refIndex = prevRefIdx;
        }
      }
      if (
        objType.$$typeof === Symbol.for("react.context") ||
        "_currentValue" in objType
      ) {
        const hadPrev = contexts.has(objType);
        const prevVal = contexts.get(objType);
        contexts.set(objType, element.props["value"]);
        try {
          return evaluateNode(
            element.props["children"] as ReactNode,
            `${path}/Ctx${keyPart}`,
          );
        } finally {
          if (hadPrev) {
            contexts.set(objType, prevVal);
          } else {
            contexts.delete(objType);
          }
        }
      }
    }
    if (typeof element.type === "string") {
      const nextPath = `${path}/${element.type}${keyPart}`;
      const children = element.props["children"] as ReactNode;
      if (children === undefined) {
        return node;
      }
      const evaluatedChildren = evaluateNode(children, nextPath);
      return React.cloneElement(
        node,
        element.props,
        ...(Array.isArray(evaluatedChildren)
          ? evaluatedChildren
          : [evaluatedChildren]),
      );
    }
    return node;
  }

  function evaluateTree(): ReactNode {
    const previousDispatcher = reactInternals.H;
    reactInternals.H = dispatcher;
    try {
      return evaluateNode(renderRoot(), "root");
    } finally {
      reactInternals.H = previousDispatcher;
    }
  }

  function collectElements(
    node: ReactNode,
    predicate: (el: EvaluatedElement) => boolean,
    results: EvaluatedElement[] = [],
  ): EvaluatedElement[] {
    if (node === null || node === undefined || typeof node !== "object") {
      return results;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        collectElements(child as ReactNode, predicate, results);
      }
      return results;
    }
    if (!isValidElement(node)) {
      return results;
    }
    const element = node as { type: unknown; props: Record<string, unknown> };
    if (typeof element.type === "string") {
      const hostEl: EvaluatedElement = {
        type: element.type,
        props: element.props,
      };
      if (predicate(hostEl)) {
        results.push(hostEl);
      }
    }
    collectElements(element.props["children"] as ReactNode, predicate, results);
    return results;
  }

  function textOf(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") {
      return "";
    }
    if (typeof node === "string" || typeof node === "number") {
      return String(node);
    }
    if (Array.isArray(node)) {
      return node.map((child) => textOf(child as ReactNode)).join("");
    }
    if (isValidElement(node)) {
      const element = node as { props: Record<string, unknown> };
      return textOf(element.props["children"] as ReactNode);
    }
    return "";
  }

  return {
    html(): string {
      const tree = evaluateTree();
      return renderToStaticMarkup(<>{tree}</>);
    },
    findButtons(labelOrText: string): EvaluatedElement[] {
      const tree = evaluateTree();
      return collectElements(
        tree,
        (el) =>
          el.type === "button" &&
          (el.props["aria-label"] === labelOrText ||
            textOf(el.props["children"] as ReactNode).trim() === labelOrText),
      );
    },
    findButton(labelOrText: string): EvaluatedElement {
      const tree = evaluateTree();
      const matches = collectElements(
        tree,
        (el) =>
          el.type === "button" &&
          (el.props["aria-label"] === labelOrText ||
            textOf(el.props["children"] as ReactNode).trim() === labelOrText),
      );
      const first = matches[0];
      if (first === undefined) {
        throw new Error(`Button not found: ${labelOrText}`);
      }
      return first;
    },
    findInput(ariaLabel: string): EvaluatedElement {
      const tree = evaluateTree();
      const matches = collectElements(
        tree,
        (el) =>
          (el.type === "input" ||
            el.type === "select" ||
            el.type === "textarea") &&
          el.props["aria-label"] === ariaLabel,
      );
      const first = matches[0];
      if (first === undefined) {
        throw new Error(`Input not found: ${ariaLabel}`);
      }
      return first;
    },
    findCheckboxes(): EvaluatedElement[] {
      const tree = evaluateTree();
      return collectElements(
        tree,
        (el) => el.type === "input" && el.props["type"] === "checkbox",
      );
    },
  };
}

describe("approval rounds panel", () => {
  // Loads the lazily split slides once, as a browser would, so synchronous renders draw them.
  beforeAll(async () => {
    await prerender(<SlidesView deck={sampleBundle.deck} />);
  });

  test("renders open round with reviewer states, Add new reviewer button, per-person Download package buttons, inline feedback triage with Incorporate and Dismiss, and disabled settle button while a reviewer is pending", () => {
    const html = renderToStaticMarkup(
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(sampleBundle)}
        initialRounds={[openRound]}
      />,
    );
    expect(html).toContain("Share for sign-off");
    expect(html).toContain("Add new reviewer");
    expect(html).toContain("Package v1 reviewers");
    expect(html).toContain("Dana Reviewer");
    expect(html).toContain("Finance VP");
    expect(html).toContain(
      'aria-label="Download Approval Package for Dana Reviewer"',
    );
    expect(html).toContain("Download package");
    expect(html).toContain("View slide deck");
    expect(html).toMatch(
      /data-cell="status"><span [^>]*data-slot="quiet-state" data-tone="warning" data-words="">Pending Feedback<\/span><\/span>/,
    );
    expect(html).not.toContain("Request changes");
    expect(html).toContain("Clarify Q3 staffing assumptions.");
    expect(html).not.toContain(
      'data-slot="quiet-state" data-tone="info" data-words="">Pending</span>',
    );
    expect(html).toContain('aria-label="Incorporate"');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('data-slot="reviewer-drawer"');
    expect(html).toContain('aria-label="Dana Reviewer Reviewer name"');
    expect(html).toContain('aria-label="Dana Reviewer Persona"');
    expect(html).toContain(
      'aria-label="Dana Reviewer Goal / decision focus (optional)"',
    );
    expect(html).toContain('aria-label="Dana Reviewer Decision"');
    expect(html).toContain('aria-label="Dana Reviewer Feedback notes"');
    expect(html).not.toContain('data-action="save"');
    expect(html).toContain("Eli Security");
    expect(html).toContain("Security Lead");
    expect(html).toContain("Generate slide deck");
    expect(html).not.toContain(
      'aria-label="Download Approval Package for Eli Security"',
    );
    expect(html).toMatch(
      /data-cell="status"><span [^>]*data-slot="quiet-state" data-tone="info" data-words="">Sent<\/span><\/span>/,
    );
    expect(html).toContain("Mark settled");
  });

  test("matches each reviewer to their curated slide deck by persona and shows Generate slide deck until a reviewer's curated deck exists, and clicking Generate slide deck immediately sends a message to the coordinator", async () => {
    sendMessageCalls = [];
    const quotes: { title: string; version: number; quote: string }[] = [];
    const ceoBundle: ApprovalPackageBundle = {
      ...sampleBundle,
      manifest: {
        ...sampleBundle.manifest,
        audience: "ceo",
        decisionNeeded: "Approve Q3 executive budget",
      },
      deck: {
        ...sampleBundle.deck,
        slides: [
          {
            layout: "title",
            title: "CEO Executive Summary Deck",
            subtitle: "Strategic ROI and budget sign-off",
          },
        ],
      },
    };
    const ctoBundle: ApprovalPackageBundle = {
      ...sampleBundle,
      manifest: {
        ...sampleBundle.manifest,
        audience: "cto",
        decisionNeeded: "Approve technical architecture",
      },
      deck: {
        ...sampleBundle.deck,
        slides: [
          {
            layout: "title",
            title: "CTO Technical Architecture Deck",
            subtitle: "Security and scalability review",
          },
        ],
      },
    };
    const multiRoleRound: ApprovalRound = {
      ...openRound,
      reviewers: [
        {
          id: "rev_ceo",
          name: "Dana Chen",
          persona: "CEO",
          state: "sent",
        },
        {
          id: "rev_cto",
          name: "Marcus Vance",
          persona: "CTO",
          state: "sent",
        },
      ],
      triage: [],
    };

    const singleDeckHarness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(ceoBundle)}
        initialRounds={[multiRoleRound]}
        onAddToPrompt={(passage) => quotes.push(passage)}
      />
    ));

    expect(singleDeckHarness.findButtons("View slide deck")).toHaveLength(1);
    const generateButtons = singleDeckHarness.findButtons(
      "Generate slide deck",
    );
    expect(generateButtons).toHaveLength(1);
    expect(
      singleDeckHarness.findButtons(
        "Download Approval Package for Marcus Vance",
      ),
    ).toHaveLength(0);

    await (generateButtons[0]!.props["onClick"] as () => Promise<void>)();
    expect(sendMessageCalls).toEqual([
      {
        projectId: "proj_1",
        content:
          "Generate a slide deck for Marcus Vance (CTO) focused on: Review and sign off from the CTO perspective..",
      },
    ]);
    expect(quotes).toHaveLength(0);
    expect(singleDeckHarness.findButtons("Generate slide deck")).toHaveLength(
      0,
    );
    const generatingBtn = singleDeckHarness.findButton(
      wording.approvalRound.generatingSlideDeck,
    );
    expect(generatingBtn.props["disabled"]).toBe(true);

    const deliveredMessages: string[] = [];
    const deliverHarness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(ceoBundle)}
        initialRounds={[multiRoleRound]}
        onDeliverMessage={async (message) => {
          deliveredMessages.push(message);
          return true;
        }}
      />
    ));
    const deliverGenerateBtn = deliverHarness.findButton("Generate slide deck");
    await (deliverGenerateBtn.props["onClick"] as () => Promise<void>)();
    expect(deliveredMessages).toEqual([
      "Generate a slide deck for Marcus Vance (CTO) focused on: Review and sign off from the CTO perspective..",
    ]);
    expect(
      deliverHarness.findButton(wording.approvalRound.generatingSlideDeck)
        .props["disabled"],
    ).toBe(true);

    const bothDecksHarness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(ceoBundle)}
        packageBundlesByVersion={
          new Map<number, ApprovalPackageBundle>([
            [1, ceoBundle],
            [2, ctoBundle],
          ])
        }
        initialRounds={[multiRoleRound]}
      />
    ));

    const viewButtons = bothDecksHarness.findButtons("View slide deck");
    expect(viewButtons).toHaveLength(2);
    expect(bothDecksHarness.findButtons("Generate slide deck")).toHaveLength(0);

    (viewButtons[1]!.props["onClick"] as () => void)();
    const ctoDeckHtml = bothDecksHarness.html();
    expect(ctoDeckHtml).toContain("Marcus Vance — CTO");
    expect(ctoDeckHtml).toContain("CTO Technical Architecture Deck");
    expect(ctoDeckHtml).not.toContain("CEO Executive Summary Deck");
  });

  test("renders no feedback triage items (Incorporate / Dismiss) for a reviewer whose decision is undefined", () => {
    const roundWithUndecidedReviewer: ApprovalRound = {
      ...openRound,
      reviewers: [
        {
          id: "rev_undecided",
          name: "Eli Security",
          persona: "Security Lead",
          state: "sent",
        },
      ],
      triage: [
        {
          itemId: "trg_orphan",
          roundId: "rnd_1",
          reviewerId: "rev_undecided",
          reviewerName: "Eli Security",
          persona: "Security Lead",
          text: "Orphaned note that should not appear without a decision.",
          status: "pending",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        initialRounds={[roundWithUndecidedReviewer]}
      />,
    );
    expect(html).toContain("Eli Security");
    expect(html).toContain('aria-label="Eli Security Decision"');
    expect(html).not.toContain(
      "Orphaned note that should not appear without a decision.",
    );
    expect(html).not.toContain("Incorporate");
    expect(html).not.toContain("Dismiss");
  });

  test("clicking Add new reviewer opens the dialog, and Add reviewer starts the round with the reviewer entered", async () => {
    startRoundCalls = [];
    const harness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        initialRounds={[openRound]}
      />
    ));

    expect(harness.html()).not.toContain('role="dialog"');

    const openBtn = harness.findButton("Add new reviewer");
    (openBtn.props["onClick"] as () => void)();

    const dialogHtml = harness.html();
    expect(dialogHtml).toContain('role="dialog"');
    expect(dialogHtml).toContain('aria-label="Reviewer 1 Reviewer name"');
    expect(dialogHtml).toContain(">Add reviewer<");

    const nameInput = harness.findInput("Reviewer 1 Reviewer name");
    (nameInput.props["onChange"] as (e: { target: { value: string } }) => void)(
      { target: { value: "Morgan Legal" } },
    );

    const personaSelect = harness.findInput("Reviewer 1 Persona");
    (
      personaSelect.props["onChange"] as (e: {
        target: { value: string };
      }) => void
    )({ target: { value: "Budget approver" } });

    const submitBtn = harness.findButtons("Add reviewer").at(-1);
    if (submitBtn === undefined) {
      throw new Error("Submit button not found");
    }
    expect(submitBtn.props["disabled"]).toBe(false);
    await (submitBtn.props["onClick"] as () => Promise<void>)();

    expect(startRoundCalls).toHaveLength(1);
    expect(startRoundCalls[0]?.body.reviewers[0]?.name).toBe("Morgan Legal");
    expect(harness.html()).toContain("Morgan Legal");
  });

  test("clicking Download package in an expanded reviewer row opens the download dialog with all files checked (Download all), and unchecking files updates the button label to Download N files / Download 1 file", () => {
    const harness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(sampleBundle)}
        initialRounds={[openRound]}
      />
    ));

    const downloadTrigger = harness.findButton(
      "Download Approval Package for Dana Reviewer",
    );
    (downloadTrigger.props["onClick"] as () => void)();

    const openedHtml = harness.html();
    expect(openedHtml).toContain("Download package — Dana Reviewer");
    expect(openedHtml).toContain("Slide deck (.pptx)");
    expect(openedHtml).toContain("Printable handout (.pdf)");
    expect(openedHtml).toContain("Brief — Customer Portal Brief (v2)");
    expect(openedHtml).toContain("Download all");

    const checkboxes = harness.findCheckboxes();
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.every((cb) => cb.props["checked"] === true)).toBe(true);

    (checkboxes[0]!.props["onChange"] as () => void)();
    expect(harness.html()).toContain("Download 2 files");

    const updatedCheckboxes = harness.findCheckboxes();
    (updatedCheckboxes[1]!.props["onChange"] as () => void)();
    expect(harness.html()).toContain("Download 1 file");
  });

  test("clicking View slide deck opens the slide deck in the right pane with Back and Expand to full screen buttons, and clicking Expand to full screen opens the modal dialog", () => {
    const harness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        packageContent={JSON.stringify(sampleBundle)}
        initialRounds={[openRound]}
      />
    ));

    expect(harness.html()).not.toContain('data-slot="pane-slide-deck"');
    expect(harness.html()).not.toContain('data-slot="slide-deck-modal"');

    const viewDeckBtn = harness.findButton("View slide deck");
    (viewDeckBtn.props["onClick"] as () => void)();

    const paneHtml = harness.html();
    expect(paneHtml).toContain('data-slot="pane-slide-deck"');
    expect(paneHtml).toContain("Dana Reviewer — Finance VP");
    expect(paneHtml).toContain("Customer Portal Approval Deck");
    expect(paneHtml).not.toContain('data-slot="slide-deck-modal"');

    const expandBtn = harness.findButton(wording.preview.expand);
    (expandBtn.props["onClick"] as () => void)();

    const modalHtml = harness.html();
    expect(modalHtml).toContain('data-slot="slide-deck-modal"');
    expect(modalHtml).toContain("Dana Reviewer — Finance VP");
    expect(modalHtml).toContain("Customer Portal Approval Deck");

    const backBtn = harness.findButton(wording.shell.back);
    (backBtn.props["onClick"] as () => void)();
    expect(harness.html()).not.toContain('data-slot="pane-slide-deck"');
  });

  test("clicking Incorporate synchronously populates onAddToPrompt and optimistically marks the item Incorporated", () => {
    const quotes: { title: string; version: number; quote: string }[] = [];
    const harness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        initialRounds={[openRound]}
        onAddToPrompt={(passage) => quotes.push(passage)}
      />
    ));

    const incorporateBtn = harness.findButton(
      wording.approvalRound.incorporate,
    );
    (incorporateBtn.props["onClick"] as () => void)();

    expect(quotes).toEqual([
      {
        title: "Dana Reviewer (Finance VP)",
        version: 1,
        quote: "Clarify Q3 staffing assumptions.",
      },
    ]);
    expect(harness.html()).toContain(
      'data-slot="quiet-state" data-tone="success" data-words="">Incorporated</span>',
    );
  });

  test("changing uniform 1-row inline fields (Name, Role, Focus, Decision, Feedback) inside the reviewer drawer reveals the field's Save button on the right and saves the updated decision/details", async () => {
    recordDecisionCalls = [];
    const harness = createStatefulHarness(() => (
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        initialRounds={[openRound]}
      />
    ));

    expect(harness.findButtons(wording.approvalRound.saveField)).toHaveLength(
      0,
    );

    const focusInput = harness.findInput(
      `Dana Reviewer ${wording.approvalRound.reviewerGoal}`,
    );
    (
      focusInput.props["onChange"] as (e: { target: { value: string } }) => void
    )({ target: { value: "Verify Q3 budget cap" } });

    const focusSaveBtn = harness.findButton(wording.approvalRound.saveField);
    await (focusSaveBtn.props["onClick"] as () => Promise<void>)();

    expect(recordDecisionCalls).toHaveLength(1);
    expect(recordDecisionCalls[0]?.reviewerId).toBe("rev_1");
    expect(recordDecisionCalls[0]?.body).toEqual({
      name: "Dana Reviewer",
      persona: "Finance VP",
      goal: "Verify Q3 budget cap",
    });

    const outcomeSelect = harness.findInput(
      `Dana Reviewer ${wording.approvalRound.outcomeLabel}`,
    );
    (
      outcomeSelect.props["onChange"] as (e: {
        target: { value: string };
      }) => void
    )({ target: { value: "approve" } });

    const noteInput = harness.findInput(
      `Dana Reviewer ${wording.approvalRound.noteLabel}`,
    );
    (noteInput.props["onChange"] as (e: { target: { value: string } }) => void)(
      { target: { value: "Approved after Q3 staffing update." } },
    );

    const saveBtns = harness.findButtons(wording.approvalRound.saveField);
    expect(saveBtns.length).toBeGreaterThanOrEqual(1);
    await (saveBtns[0]!.props["onClick"] as () => Promise<void>)();

    expect(recordDecisionCalls).toHaveLength(2);
    expect(recordDecisionCalls[1]?.reviewerId).toBe("rev_1");
    expect(recordDecisionCalls[1]?.body).toEqual({
      outcome: "approve",
      note: "Approved after Q3 staffing update.",
    });
  });

  test("renders share dialog with expiry selector, numbered reviewer inputs, Add reviewer submit button, and cancel button", () => {
    const html = renderToStaticMarkup(
      <SharePackageDialog
        projectId="proj_1"
        packageVersion={1}
        onCreated={() => {}}
        onCancel={() => {}}
        onFault={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Add new reviewer"');
    expect(html).toContain('aria-label="Expires in"');
    expect(html).toContain('aria-label="Reviewer 1"');
    expect(html).toContain('data-slot="approval-fields" data-variant="form"');
    expect(html).not.toContain("Pick from workspace");
    expect(html).toContain('aria-label="Reviewer 1 Reviewer name"');
    expect(html).toContain('aria-label="Reviewer 1 Persona"');
    expect(html).toContain("Budget approver");
    expect(html).toContain("Technical approver");
    expect(html).toContain("Other…");
    expect(html).toContain('aria-label="Reviewer 1 Email (optional)"');
    expect(html).toContain("Save to workspace?");
    expect(html).toContain("Save reviewer for future projects");
    expect(html).toContain(
      "Saves this reviewer to the workspace so you can pick them in any project without retyping their details.",
    );
    expect(html).toContain("Add reviewer");
    expect(html.split(">Add reviewer<")).toHaveLength(2);
    expect(html).toContain("Cancel");
  });

  test("renders WorkspaceApprovals settings section with require stakeholder approval toggle and no workspace reviewers until some are saved", () => {
    const html = renderToStaticMarkup(<WorkspaceApprovals />);
    expect(html).toContain("Workspace approvals");
    expect(html).toContain("Require stakeholder approval");
    expect(html).toContain("Workspace reviewers");
    expect(html).toContain("No saved workspace reviewers yet.");
    expect(html).toContain('data-slot="approval-fields" data-variant="form"');
    expect(html).toMatch(
      /<input [^>]*data-slot="lean-input"[^>]*data-variant="form"/,
    );
    expect(html).toMatch(
      /<select [^>]*data-slot="lean-select"[^>]*data-variant="form"/,
    );
    expect(html).toContain("Add reviewer");
    expect(html).toContain("Other…");
  });

  test("lists saved workspace reviewers in Settings and the share dialog picker", () => {
    writeWorkspaceReviewers([
      { id: "ws-rev-jordan-lee", name: "Jordan Lee", persona: "CTO" },
    ]);
    readWorkspaceReviewers();
    try {
      const settingsHtml = renderToStaticMarkup(<WorkspaceApprovals />);
      expect(settingsHtml).toContain("Jordan Lee");
      expect(settingsHtml).toContain('data-slot="inline-note">CTO</span>');
      expect(settingsHtml).toContain("Remove");
      const dialogHtml = renderToStaticMarkup(
        <SharePackageDialog
          projectId="proj_1"
          packageVersion={1}
          onCreated={() => {}}
          onCancel={() => {}}
          onFault={() => {}}
        />,
      );
      expect(dialogHtml).toContain(
        'aria-label="Reviewer 1 Pick from workspace"',
      );
      expect(dialogHtml).toContain("Jordan Lee (CTO)");
    } finally {
      writeWorkspaceReviewers([]);
      readWorkspaceReviewers();
    }
  });

  test("renders WhatsNewDialog with Slide Decks and Approvals tabs, where Slide Decks is built-in and only Approvals is Experimental", () => {
    const slideDecksHtml = renderToStaticMarkup(
      <WhatsNewDialog
        open
        initialTab="slideDecks"
        onClose={() => {}}
        onOpenPreferences={() => {}}
      />,
    );
    expect(slideDecksHtml).toContain("What&#x27;s new");
    expect(slideDecksHtml).toContain('role="tablist"');
    expect(slideDecksHtml).toContain("Slide decks");
    expect(slideDecksHtml).toContain("Approvals");
    expect(slideDecksHtml).not.toContain("Experimental");
    expect(slideDecksHtml).not.toContain("Enable in Settings");

    const approvalsHtml = renderToStaticMarkup(
      <WhatsNewDialog
        open
        initialTab="approvals"
        onClose={() => {}}
        onOpenPreferences={() => {}}
      />,
    );
    expect(approvalsHtml).toContain("Approvals");
    expect(approvalsHtml).toContain("Experimental — off by default");
    expect(approvalsHtml).toContain("Enable in Settings");
  });

  test("opens Settings directly to the Preferences tab and renders Approvals (Experimental) off by default", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Settings
            onChanged={() => {}}
            requestedTab="preferences"
            focusPreference="experimental_approvals"
          />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(html).toContain("How Builder works with you");
    expect(html).not.toContain("Slide Decks");
    expect(html).toContain("Approvals (Experimental)");
    expect(html).toContain('id="preference-experimental_approvals"');
    expect(html).not.toContain('id="preference-experimental_slide_decks"');
    expect(html).toContain('data-highlighted=""');
  });
});
