import { PARSED_DOCUMENT_POLICY } from "@corbits/artifacts";
import {
  ATTACHMENT_ALLOWLIST,
  base64Encode,
  isTextLikeMimeType,
  MAX_ATTACHMENTS_PER_MESSAGE,
  mimeTypeAndSubtype,
  PER_ATTACHMENT_LIMIT_BYTES,
  PER_MESSAGE_TOTAL_LIMIT_BYTES,
} from "@intx/types";
import type { AcceptedMaterials } from "@corbits-builder/schemas/artifact";

// Interchange hands a model each attachment as an image or document block (inference turns.ts
// attachmentToContentBlock); a model reads one only when its offering declares that input.
const READS: Readonly<Record<string, string>> = {
  "vision-input": "image",
  "document-input": "document",
};

export function acceptedMaterials(
  capabilities: readonly string[],
): AcceptedMaterials {
  const categories = new Set(
    capabilities.map((capability) => READS[capability]),
  );
  return {
    mimeTypes: Object.entries(ATTACHMENT_ALLOWLIST)
      .filter(([, category]) => categories.has(category))
      .map(([mimeType]) => mimeType),
    maxFiles: MAX_ATTACHMENTS_PER_MESSAGE,
    maxFileBytes: PER_ATTACHMENT_LIMIT_BYTES,
    maxTotalBytes: PER_MESSAGE_TOTAL_LIMIT_BYTES,
  };
}

// The declared type when Interchange takes it, else the one the filename's extension names, as
// @corbits/artifacts' effectiveUploadMime does for its mail-attachment policy (not exported).
export function materialMimeType(file: { name: string; type: string }): string {
  const declared = mimeTypeAndSubtype(file.type);
  if (PARSED_DOCUMENT_POLICY.accepts(declared)) return declared;
  const name = file.name.toLowerCase();
  for (const [extension, mimeType] of PARSED_DOCUMENT_POLICY.extensions)
    if (name.endsWith(extension)) return mimeType;
  return declared;
}

// A mailed attachment's name sits in a signed MIME header with no encoding, so the assembler takes
// US-ASCII only; the validator the hub runs first does not check that. The material keeps the
// person's name; the mailed copy carries this one, which the coordinator still reads as the file.
const ASCII_SPACE_LIKE = /[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g;

/** The name a file is mailed under: the person's, with every non-ASCII character made plain. */
export function mailAttachmentName(name: string): string {
  const plain = name
    .replace(ASCII_SPACE_LIKE, " ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/"/g, "'")
    .trim();
  return plain === "" ? "attachment" : plain;
}

function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

export function materialContent(mimeType: string, bytes: Uint8Array): string {
  const text = isTextLikeMimeType(mimeType) ? utf8(bytes) : undefined;
  return text ?? `data:${mimeType};base64,${base64Encode(bytes)}`;
}
