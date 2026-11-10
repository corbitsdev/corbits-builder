/**
 * An approval package as the hub files it, and which reviewer of a round each package's deck was
 * tailored to: by the audience it names, else by the reviewer it mentions.
 */
import { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import type {
  ApprovalReviewer,
  ApprovalRound,
} from "@corbits-builder/schemas/approval-round";
import { type } from "arktype";
import { wording } from "../../config.ts";

const roundText = wording.approvalRound;

export const APPROVAL_PACKAGE_MEDIA_TYPE =
  "application/vnd.corbits-builder.approval-package+json";

export function parseApprovalPackage(
  content: string,
): ApprovalPackageBundle | null {
  try {
    const parsed: unknown = JSON.parse(content);
    const result = ApprovalPackageBundle(parsed);
    if (result instanceof type.errors) return null;
    return result;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

function normalizePersonaToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const KNOWN_PERSONA_TOKENS: ReadonlySet<string> = new Set(
  roundText.reviewerPersonas.map((persona) => normalizePersonaToken(persona)),
);

export function doesBundleMatchReviewer(
  bundle: ApprovalPackageBundle,
  reviewer: { name: string; persona: string },
): boolean {
  const personaToken = normalizePersonaToken(reviewer.persona);
  if (personaToken === "") return false;
  const audienceRaw = bundle.manifest.audience.trim().toLowerCase();
  const audienceToken = normalizePersonaToken(bundle.manifest.audience);
  if (audienceToken !== "") {
    if (audienceToken === personaToken) return true;
    if (
      audienceToken.startsWith(`${personaToken}_`) ||
      audienceToken.endsWith(`_${personaToken}`) ||
      audienceToken.includes(`_${personaToken}_`)
    ) {
      return true;
    }
  }
  const reviewerNameLower = reviewer.name.trim().toLowerCase();
  if (reviewerNameLower !== "") {
    if (audienceRaw.includes(reviewerNameLower)) return true;
    if (
      bundle.manifest.decisionNeeded.toLowerCase().includes(reviewerNameLower)
    ) {
      return true;
    }
  }
  return false;
}

export function resolveReviewerPackage({
  reviewer,
  reviewerIndex,
  round,
  bundlesByVersion,
  fallbackBundle,
  newlyAddedReviewerIds,
}: {
  reviewer: ApprovalReviewer;
  reviewerIndex: number;
  round: ApprovalRound;
  bundlesByVersion: ReadonlyMap<number, ApprovalPackageBundle>;
  fallbackBundle: ApprovalPackageBundle | null;
  newlyAddedReviewerIds?: ReadonlySet<string> | undefined;
}): {
  bundle: ApprovalPackageBundle | null;
  packageVersion: number;
} {
  const sortedVersions = [...bundlesByVersion.keys()].sort((a, b) => b - a);
  for (const version of sortedVersions) {
    const candidate = bundlesByVersion.get(version);
    if (
      candidate !== undefined &&
      doesBundleMatchReviewer(candidate, reviewer)
    ) {
      return {
        bundle: candidate,
        packageVersion: version,
      };
    }
  }
  if (
    fallbackBundle !== null &&
    doesBundleMatchReviewer(fallbackBundle, reviewer)
  ) {
    return {
      bundle: fallbackBundle,
      packageVersion: round.packageVersion,
    };
  }
  const fallbackAudienceToken =
    fallbackBundle === null
      ? ""
      : normalizePersonaToken(fallbackBundle.manifest.audience);
  const reviewerPersonaToken = normalizePersonaToken(reviewer.persona);
  const isFallbackGeneric =
    fallbackBundle !== null &&
    !KNOWN_PERSONA_TOKENS.has(fallbackAudienceToken) &&
    !round.reviewers.some((other) =>
      doesBundleMatchReviewer(fallbackBundle, other),
    );
  const isReviewerNewlyAdded = newlyAddedReviewerIds?.has(reviewer.id) === true;
  if (
    fallbackBundle !== null &&
    reviewerIndex === 0 &&
    !isReviewerNewlyAdded &&
    isFallbackGeneric &&
    !KNOWN_PERSONA_TOKENS.has(reviewerPersonaToken)
  ) {
    return {
      bundle: fallbackBundle,
      packageVersion: round.packageVersion,
    };
  }
  return {
    bundle: null,
    packageVersion: round.packageVersion,
  };
}
