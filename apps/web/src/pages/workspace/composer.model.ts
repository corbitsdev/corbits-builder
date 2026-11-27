/**
 * The words in the prompt box, the files beside them, and messages on their way to the
 * coordinator. The room picks where a send goes (a question, an approval or the coordinator). This
 * hook posts it, puts it in the transcript before the hub confirms it, and gives the words back to
 * the box if it fails.
 */
import { useEffect, useRef, useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  type AttachmentItem,
  type AttachmentRejection,
  useAttachments,
} from "@corbits/react-ui";
import { toast } from "sonner";
import { wording } from "../../config.ts";
import { composerKey, useUnsent } from "../../unsent.ts";
import { sendMessage, type ConversationTurn } from "../../api/conversation.ts";
import { acceptedMaterials, attachMaterials } from "../../api/artifacts.ts";
import type { ChatMessage } from "../../api/types.ts";
import { keys } from "../../queries/keys.ts";
import { humanFault, humanFaultWithCode, responseCode } from "./human-fault.ts";
import { latestTurnAt, SENDING, type SentMessage } from "./pending-sends.ts";
import type { RoomComposer } from "./prompt-box.view.tsx";

export function acceptedMaterialsQuery(projectId: string) {
  return queryOptions({
    queryKey: keys.acceptedMaterials.of(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => acceptedMaterials(projectId),
  });
}

function openingDraft(
  projectId: string,
  openingMessage: string | undefined,
): SentMessage[] {
  const text = openingMessage?.trim();
  if (text === undefined || text.length === 0) return [];
  return [
    {
      id: `opening:${projectId}`,
      author: "me",
      body: text,
      at: new Date(0).toISOString(),
      after: Number.NEGATIVE_INFINITY,
    },
  ];
}

function rejectionText(
  rejection: AttachmentRejection<File>,
  limits: { maxFiles: number; maxFileBytes: number },
): string {
  if (rejection.reason === "too-many")
    return wording.attach.tooMany(limits.maxFiles);
  if (rejection.reason === "too-large")
    return wording.attach.tooLarge(rejection.file.name, limits.maxFileBytes);
  return wording.attach.duplicate(rejection.file.name);
}

async function attachFaultText(cause: unknown): Promise<string> {
  const code = await responseCode(cause);
  return (
    (code === undefined ? undefined : wording.attach.fault[code]) ??
    humanFault(cause, wording.attach.notSent)
  );
}

const notSent = "That message was not sent.";

export function useComposer({
  projectId,
  openingMessage,
  mirror,
  onChanged,
  reload,
}: {
  projectId: string;
  /** What the person typed to start the project, shown as sent until the room has it. */
  openingMessage: string | undefined;
  /** The committed transcript, which a message sent now comes after. */
  mirror: readonly ConversationTurn[];
  onChanged: () => void;
  reload: () => void;
}) {
  const [sent, setSent] = useState<SentMessage[]>(() =>
    openingDraft(projectId, openingMessage),
  );
  const [text, setText] = useUnsent(composerKey(projectId));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  // When this session last sent the coordinator a message, until a run ends after it or it fails.
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const limits = useQuery(acceptedMaterialsQuery(projectId)).data;
  const [files, setFiles] = useState<readonly AttachmentItem[]>([]);
  const [attachFault, setAttachFault] = useState<string | null>(null);
  const intake = useAttachments({
    attachments: files,
    ...(limits === undefined
      ? {}
      : { maxFiles: limits.maxFiles, maxFileBytes: limits.maxFileBytes }),
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A project just started could be typed into while it opened, and the box that was typed in
  // is gone; the cursor carries on in this one, after the words.
  useEffect(() => {
    if (openingMessage === undefined) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const box = inputRef.current;
    if (box === null) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [projectId, openingMessage]);

  const post = async (words: string): Promise<ChatMessage> =>
    (await sendMessage(projectId, words)).message;

  /**
   * Sends one message as the person; resolves whether it went. `post` is how it goes, an ordinary
   * message unless the room sends it another way, such as declining an approval with it.
   */
  const mail = async (
    body: string,
    clearBox = false,
    send: (words: string) => Promise<ChatMessage> = post,
  ): Promise<boolean> => {
    const words = body.trim();
    if (words.length === 0 || sending) return false;
    setSending(true);
    setFailed(false);
    setFault(null);
    setAwaitingSince(Date.now());
    // The person's words show the moment they send; the receipt replaces this stand-in.
    const pending: SentMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: words,
      at: new Date().toISOString(),
      after: latestTurnAt(mirror),
    };
    setSent((previous) => [...previous, pending]);
    if (clearBox) setText("");
    try {
      const message = await send(words);
      setSent((previous) =>
        previous.map((item) =>
          item === pending ? { ...pending, ...message } : item,
        ),
      );
      reload();
      onChanged();
      return true;
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      if (clearBox) setText((current) => (current === "" ? words : current));
      const message = await humanFaultWithCode(cause, notSent);
      setFailed(true);
      setFault(message);
      toast.error(message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const addFiles = (picked: ArrayLike<File>) => {
    if (limits === undefined) return;
    const { accepted: taken, rejected } = intake.add(picked);
    let total = files.reduce((sum, item) => sum + item.size, 0);
    const fitting = taken.filter((item) => {
      if (total + item.size > limits.maxTotalBytes) return false;
      total += item.size;
      return true;
    });
    const refused = rejected[0];
    if (refused !== undefined) setAttachFault(rejectionText(refused, limits));
    else if (fitting.length < taken.length)
      setAttachFault(wording.attach.tooLargeTotal(limits.maxTotalBytes));
    else setAttachFault(null);
    setFiles((current) => [...current, ...fitting]);
  };

  /** Sends the attached files with the words typed beside them; resolves whether they went. */
  const sendFiles = async (): Promise<boolean> => {
    if (sending) return false;
    const words = text.trim();
    const attached = files;
    setSending(true);
    setFailed(false);
    setFault(null);
    setAwaitingSince(Date.now());
    setAttachFault(null);
    const pending: SentMessage = {
      id: `${SENDING}${String(Date.now())}`,
      author: "me",
      body: words,
      at: new Date().toISOString(),
      after: latestTurnAt(mirror),
      files: attached.map((item) => ({
        kind: "file" as const,
        name: item.name,
        mediaType: item.mediaType,
      })),
    };
    setSent((previous) => [...previous, pending]);
    setText("");
    setFiles([]);
    try {
      await attachMaterials(
        projectId,
        attached.flatMap((item) =>
          item.file === undefined ? [] : [item.file],
        ),
        words.length === 0 ? undefined : words,
      );
      // Without words the hub mails its own note naming the files, which the mirror shows.
      if (words.length === 0)
        setSent((previous) => previous.filter((item) => item !== pending));
      reload();
      onChanged();
      return true;
    } catch (cause) {
      setAwaitingSince(null);
      setSent((previous) => previous.filter((item) => item !== pending));
      setText((current) => (current === "" ? words : current));
      setFiles(attached);
      setAttachFault(await attachFaultText(cause));
      return false;
    } finally {
      setSending(false);
    }
  };

  return {
    text,
    setText,
    inputRef,
    /** Messages sent from here that the committed transcript may not show yet. */
    sent,
    sending,
    setSending,
    /** The last send, or the coordinator's run, failed, and why. */
    failed,
    fault,
    /** Marks the coordinator as stopped with this sentence, as a failed send would. */
    fail: (message: string) => {
      setFailed(true);
      setFault(message);
    },
    awaitingSince,
    post,
    mail,
    sendFiles,
    /** What the prompt box shows of what is being written. */
    box: {
      text,
      onTextChange: setText,
      inputRef,
      attachments: {
        files,
        accept:
          limits === undefined || limits.mimeTypes.length === 0
            ? null
            : limits.mimeTypes.join(","),
        fault: attachFault,
        onAdd: addFiles,
        onRemove: (id: string) =>
          setFiles((current) => current.filter((held) => held.id !== id)),
      },
      sendFault: failed && fault !== null ? fault : null,
    } satisfies Pick<
      RoomComposer,
      "text" | "onTextChange" | "inputRef" | "attachments" | "sendFault"
    >,
    /** Adds words to the end of what is typed and puts the cursor there. */
    add: (words: string) => {
      setText((current) =>
        current.trim().length === 0
          ? words
          : `${current.trimEnd()}\n\n${words}`,
      );
      inputRef.current?.focus();
    },
    /** Puts words back in the box when it is empty, as a send that did not go. */
    restore: (words: string) =>
      setText((current) => (current.trim().length === 0 ? words : current)),
  };
}
