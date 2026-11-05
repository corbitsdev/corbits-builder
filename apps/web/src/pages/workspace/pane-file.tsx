/**
 * A pane's Download and Share actions for the one file it gives away: a document as Markdown, a
 * spreadsheet as its CSV, a design as a zip, the app as the hub's zip. Both actions take the same
 * file, built before the press where it can be, because a share sheet opens only inside the press
 * that asked for it.
 */
import JSZip from "jszip";
import { useEffect, useRef } from "react";
import { Download, Share } from "lucide-react";
import { toast } from "sonner";
import { wording } from "../../config.ts";
import type { PaneBarGroup } from "./pane-bar.tsx";

const MARKDOWN_TYPE = "text/markdown";
export const ZIP_TYPE = "application/zip";
const CSV_TYPE = "text/csv";

const EXTENSION: Record<string, string> = {
  [MARKDOWN_TYPE]: "md",
  [ZIP_TYPE]: "zip",
  [CSV_TYPE]: "csv",
};

/** A file name a person's system keeps as one name, as the hub names the app's zip. */
export const fileStem = (...parts: readonly string[]) =>
  parts
    .join("-")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+/, "");

export const markdownFile = (stem: string, markdown: string) =>
  new File([markdown], `${stem}.md`, { type: MARKDOWN_TYPE });

export const csvFile = (stem: string, csv: string) =>
  new File([csv], `${stem}.csv`, { type: CSV_TYPE });

/** The files under one directory named after the zip, as the app's zip is laid out. */
export async function zipFile(
  stem: string,
  files: Readonly<Record<string, string>>,
) {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(files))
    zip.file(`${stem}/${path}`, data);
  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  return new File([archive], `${stem}.zip`, { type: ZIP_TYPE });
}

function save(file: File) {
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = file.name;
  link.click();
  // Safari starts the download after click() returns, so an immediate revoke cancels it.
  setTimeout(() => URL.revokeObjectURL(href));
}

const failed = (cause: unknown) =>
  toast.error(cause instanceof Error ? cause.message : String(cause));

// Support is asked of an empty file of the same kind, so Share shows before the file is built.
const canShare = (type: string) =>
  navigator.canShare?.({
    files: [new File([], `file.${EXTENSION[type] ?? "bin"}`, { type })],
  }) === true;

async function share(file: File) {
  try {
    await navigator.share({ files: [file] });
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === "AbortError"))
      failed(cause);
  }
}

// Only the build is caught: a failure in what the press then does with the file is not a failed build.
async function builtOrReported(prepared: Prepared): Promise<Built | null> {
  try {
    return await prepared.built;
  } catch (cause) {
    failed(cause);
    return null;
  }
}

type Built = { file: File; note?: string; stale?: boolean };

export type PaneFile = {
  type: string;
  download: string;
  share: string;
  /** Names the file's content; a new key builds it again. */
  key: string;
  /**
   * When the file is built: as soon as the bar shows it, or, for a file that costs requests, once
   * a pointer or focus reaches Share.
   */
  prepare: "shown" | "intent";
  /** The file and what the download toast says about it; stale warns that it is an older version. */
  build: () => Promise<Built>;
};

// A file built on intent is reused only this long, so what a press gives away is never older.
const INTENT_FRESH_MS = 30_000;

type Prepared = {
  key: string;
  at: number;
  built: Promise<Built>;
  ready?: Built;
};

export function useFileGroup(source: PaneFile | null): PaneBarGroup {
  const prepared = useRef<Prepared | null>(null);
  const prepare = (file: PaneFile): Prepared => {
    const held = prepared.current;
    if (
      held !== null &&
      held.key === file.key &&
      (file.prepare === "shown" || Date.now() - held.at < INTENT_FRESH_MS)
    )
      return held;
    const next: Prepared = {
      key: file.key,
      at: Date.now(),
      built: file.build(),
    };
    void keepOrForget(next);
    prepared.current = next;
    return next;
  };
  // A failed build is reported by the press that waits on it; this only lets the next press build again.
  const keepOrForget = async (held: Prepared) => {
    const [outcome] = await Promise.allSettled([held.built]);
    if (outcome.status === "fulfilled") held.ready = outcome.value;
    else if (prepared.current === held) prepared.current = null;
  };
  const download = async (file: PaneFile) => {
    const built = await builtOrReported(prepare(file));
    if (built === null) return;
    save(built.file);
    (built.stale === true ? toast.warning : toast.success)(
      built.note ?? wording.paneFile.downloaded(built.file.name),
    );
  };
  // The build outlived the press, so sharing needs a press of its own.
  const offerShare = async (held: Prepared) => {
    const built = await builtOrReported(held);
    if (built === null) return;
    toast(wording.paneFile.shareReady(built.file.name), {
      action: {
        label: wording.paneFile.shareNow,
        onClick: () => void share(built.file),
      },
    });
  };
  useEffect(() => {
    if (source?.prepare === "shown") prepare(source);
  });
  if (source === null) return [];
  return [
    {
      id: "download",
      label: source.download,
      icon: <Download size={16} aria-hidden="true" />,
      onSelect: () => void download(source),
    },
    ...(canShare(source.type)
      ? [
          {
            id: "share",
            label: source.share,
            icon: <Share size={16} aria-hidden="true" />,
            onPrepare: () => {
              prepare(source);
            },
            onSelect: () => {
              const held = prepare(source);
              if (held.ready === undefined) void offerShare(held);
              else void share(held.ready.file);
            },
          },
        ]
      : []),
  ];
}
