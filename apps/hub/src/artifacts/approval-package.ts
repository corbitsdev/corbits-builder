import { type } from "arktype";
import {
  getArtifact,
  getArtifactVersion,
  type ArtifactDb,
} from "@corbits/artifacts";
import {
  ApprovalPackageBundle,
  type ApprovalPackageSource,
  type PresenterAssignment,
} from "@corbits-builder/schemas/artifact";
import { parseJson } from "../lib/json.ts";
import { ProjectError, type ProjectErrorIssue } from "../projects/errors.ts";

// An approval package summarizes planning and design documents for stakeholders; the built app and
// earlier approval packages are never pinned as package sources.
export const EXCLUDED_PACKAGE_SOURCE_KINDS = new Set([
  "app",
  "approval_package",
]);

const SECRET_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  {
    label: "api_key",
    pattern:
      /(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xai-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})/,
  },
  {
    label: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    label: "demo_login",
    pattern: /demoLogin/,
  },
  {
    label: "live_app_url",
    pattern: /http:\/\/(?:127\.0\.0\.1|localhost):/,
  },
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredPackageSource = {
  kind: string;
  version: number;
  sha256: string;
  approved?: boolean;
};

export type StoredSourceReader = (
  artifactId: string,
  version: number,
) => Promise<StoredPackageSource | undefined>;

function scanSectionForSecrets(
  path: string,
  text: string,
): ProjectErrorIssue[] {
  const issues: ProjectErrorIssue[] = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) issues.push({ path, message: label });
  }
  return issues;
}

export function scanApprovalPackageForSecrets(
  bundle: ApprovalPackageBundle,
): void {
  const manifestText = [
    bundle.manifest.audience,
    bundle.manifest.decisionNeeded,
    bundle.manifest.tone,
    bundle.manifest.length,
    ...bundle.manifest.sources.map((source) => source.title),
  ].join("\n");
  const issues: ProjectErrorIssue[] = [
    ...scanSectionForSecrets("manifest", manifestText),
    ...scanSectionForSecrets("deck", JSON.stringify(bundle.deck)),
  ];
  if (bundle.documents !== undefined) {
    for (const [name, content] of Object.entries(bundle.documents)) {
      issues.push(...scanSectionForSecrets(`documents/${name}`, content));
    }
  }
  if (issues.length > 0)
    throw new ProjectError(422, "package_contains_secret", issues);
}

export function parseApprovalPackageBundle(
  content: string,
): ApprovalPackageBundle {
  const bundle = ApprovalPackageBundle(parseJson(content));
  if (bundle instanceof type.errors)
    throw new ProjectError(400, "invalid_approval_package", {
      issues: bundle.summary,
    });
  return bundle;
}

export async function verifySourcePin(
  source: ApprovalPackageSource,
  readSource: StoredSourceReader,
  path: string,
): Promise<void> {
  if (EXCLUDED_PACKAGE_SOURCE_KINDS.has(source.kind))
    throw new ProjectError(422, "excluded_package_source_kind", [
      { path, message: source.kind },
    ]);
  const stored = await readSource(source.artifactId, source.version);
  if (
    stored === undefined ||
    stored.kind !== source.kind ||
    stored.version !== source.version ||
    stored.sha256 !== source.sha256
  )
    throw new ProjectError(422, "invalid_package_source", [
      {
        path,
        message: `${source.artifactId}@${String(source.version)}`,
      },
    ]);
  if (stored.approved === false)
    throw new ProjectError(422, "unapproved_package_source", [
      {
        path,
        message: `${source.kind}@${String(source.version)}`,
      },
    ]);
}

function verifySealedAssignment(
  bundle: ApprovalPackageBundle,
  sealed: PresenterAssignment,
): void {
  if (bundle.manifest.audience.trim() !== sealed.audience.trim()) {
    throw new ProjectError(422, "package_assignment_mismatch", [
      {
        path: "manifest.audience",
        message: `expected ${sealed.audience}`,
      },
    ]);
  }
  if (bundle.manifest.decisionNeeded.trim() !== sealed.decisionNeeded.trim()) {
    throw new ProjectError(422, "package_assignment_mismatch", [
      {
        path: "manifest.decisionNeeded",
        message: `expected ${sealed.decisionNeeded}`,
      },
    ]);
  }
  const actualKeys = bundle.manifest.sources.map(
    (s) => `${s.artifactId}:${s.kind}:${String(s.version)}:${s.sha256}`,
  );
  const expectedKeys = sealed.sources.map(
    (s) => `${s.artifactId}:${s.kind}:${String(s.version)}:${s.sha256}`,
  );
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, idx) => key !== expectedKeys[idx])
  ) {
    throw new ProjectError(422, "package_assignment_mismatch", [
      {
        path: "manifest.sources",
        message: "sources do not match the approved hand-off selection",
      },
    ]);
  }
}

export async function validateApprovalPackage(
  input: string | ApprovalPackageBundle,
  readSource: StoredSourceReader,
  sealedAssignment?: PresenterAssignment,
): Promise<ApprovalPackageBundle> {
  const bundle =
    typeof input === "string" ? parseApprovalPackageBundle(input) : input;
  for (const source of bundle.manifest.sources) {
    if (EXCLUDED_PACKAGE_SOURCE_KINDS.has(source.kind))
      throw new ProjectError(422, "excluded_package_source_kind", [
        { path: "manifest.sources", message: source.kind },
      ]);
  }
  scanApprovalPackageForSecrets(bundle);
  if (sealedAssignment !== undefined) {
    verifySealedAssignment(bundle, sealedAssignment);
  }
  for (const source of bundle.manifest.sources)
    await verifySourcePin(source, readSource, "manifest.sources");
  return bundle;
}

export function readProjectPackageSource(
  db: ArtifactDb,
  tenantId: string,
  isApproved?: (
    artifactId: string,
    kind: string,
    version: number,
  ) => Promise<boolean>,
): StoredSourceReader {
  return async (artifactId, version) => {
    if (!UUID_RE.test(artifactId)) return undefined;
    const row = await getArtifact(db, artifactId);
    if (!row || row.tenantId !== tenantId) return undefined;
    const stored = await getArtifactVersion(db, artifactId, version);
    if (!stored?.contentSha256) return undefined;
    const approved =
      isApproved === undefined
        ? true
        : await isApproved(artifactId, row.kind, stored.version);
    return {
      kind: row.kind,
      version: stored.version,
      sha256: stored.contentSha256,
      approved,
    };
  };
}

function base64PaddingBytes(encoded: string): number {
  if (encoded.endsWith("==")) return 2;
  if (encoded.endsWith("=")) return 1;
  return 0;
}

function base64ByteLength(encoded: string): number {
  return Math.max(
    0,
    Math.floor((encoded.length * 3) / 4) - base64PaddingBytes(encoded),
  );
}

// Agents reading an approval_package need its manifest, deck structure and markdown documents, not
// megabytes of base64 binary that would trip the tool-output size cap.
export function stripApprovalPackageBinaries(content: string): string {
  const bundle = ApprovalPackageBundle(parseJson(content));
  if (bundle instanceof type.errors) return content;
  const { pptxBase64, pdfBase64, ...rest } = bundle;
  return JSON.stringify({
    ...rest,
    pptxBytes: base64ByteLength(pptxBase64),
    pdfBytes: base64ByteLength(pdfBase64),
  });
}
