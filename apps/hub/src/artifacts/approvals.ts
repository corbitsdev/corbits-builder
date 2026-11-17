import { and, eq } from "drizzle-orm";
import {
  getArtifactVersion,
  listArtifacts,
  MAX_LIST_LIMIT,
  type ArtifactDb,
} from "@corbits/artifacts";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import {
  declaredPackages,
  type ApprovedPackages,
} from "@corbits-builder/schemas/package-install";
import { artifactApproval, artifactImportApproval } from "../db/schema.ts";

/**
 * The newest version of an artifact a deploy's approval or the person approved, while it is
 * still stored as approved; undefined when none is.
 */
export async function approvedVersion(
  db: ArtifactDb,
  tenantId: string,
  artifactId: string,
) {
  const deployed = await db
    .select({
      version: artifactApproval.version,
      sha256: artifactApproval.sha256,
    })
    .from(artifactApproval)
    .where(
      and(
        eq(artifactApproval.tenantId, tenantId),
        eq(artifactApproval.artifactId, artifactId),
      ),
    );
  const imported = await db
    .select({
      version: artifactImportApproval.version,
      sha256: artifactImportApproval.sha256,
    })
    .from(artifactImportApproval)
    .where(
      and(
        eq(artifactImportApproval.tenantId, tenantId),
        eq(artifactImportApproval.artifactId, artifactId),
      ),
    );
  const covered = [...deployed, ...imported].sort(
    (a, b) => b.version - a.version,
  );
  for (const row of covered) {
    const stored = await getArtifactVersion(db, artifactId, row.version);
    if (stored?.contentSha256 === row.sha256) return row.version;
  }
  return undefined;
}

/**
 * The packages a coder run installs without asking: those each document declares in the version
 * the person approved, read from that version, so a revision not yet approved adds none. A run
 * whose install_packages is denied, or that holds none, is given none, so a document never widens
 * what the run may install.
 */
export async function preapprovedPackages<T extends { kind: string }>(
  installs: "allow" | "ask" | "deny" | undefined,
  documents: readonly T[],
  approved: (document: T) => Promise<string | undefined>,
): Promise<ApprovedPackages> {
  if (installs === undefined || installs === "deny") return { documents: [] };
  const declared = [];
  for (const document of documents) {
    if (!isDocumentKind(document.kind)) continue;
    const content = await approved(document);
    const packages = content === undefined ? [] : declaredPackages(content);
    if (packages.length) declared.push({ kind: document.kind, packages });
  }
  return { documents: declared };
}

/** The packages a coder run whose install_packages grant is installs may install without asking. */
export async function approvedPackages(
  db: ArtifactDb,
  tenantId: string,
  installs: "allow" | "ask" | "deny" | undefined,
) {
  const { rows } = await listArtifacts(db, tenantId, { limit: MAX_LIST_LIMIT });
  return preapprovedPackages(installs, rows, async (row) => {
    const version = await approvedVersion(db, tenantId, row.id);
    if (version === undefined) return undefined;
    return (await getArtifactVersion(db, row.id, version))?.content;
  });
}
