/**
 * Where the person's words go when they send them. While the coordinator waits on its question they
 * are the answer; while an approval is open they are the reason it is declined, or a plain "yes"
 * held against it; otherwise they are mail to the coordinator. Picking an approach goes the same
 * way, and so does the cursor's return to the box once a decline lets it take words again.
 */
import { useEffect, useState } from "react";
import type {
  ConversationQuestion,
  GivenQuestionAnswer,
} from "@corbits-builder/schemas/conversation";
import { wording } from "../../../config.ts";
import {
  chooseApproachWithOpenApproval,
  deliverWithOpenApproval,
  useTypedYes,
} from "../approvals/approval-reply.ts";
import { openApprovalOf } from "../collaboration.ts";
import type { useComposer } from "./composer.model.ts";
import type { RoomDecisions } from "../approvals/decisions.model.ts";

export function useDelivery({
  composer,
  question,
  decisions,
  composerDisabled,
}: {
  composer: Pick<
    ReturnType<typeof useComposer>,
    | "text"
    | "setText"
    | "inputRef"
    | "sending"
    | "mail"
    | "sendFiles"
    | "box"
    | "restore"
  >;
  question: {
    openQuestion: ConversationQuestion | undefined;
    answer: (
      signalName: string,
      answer: GivenQuestionAnswer,
    ) => Promise<boolean>;
  };
  decisions: Pick<
    RoomDecisions,
    | "pendingApprovals"
    | "readPendingApprovals"
    | "onDecideApproval"
    | "declineWith"
  >;
  /** The box cannot take words right now. */
  composerDisabled: boolean;
}) {
  const { sending } = composer;
  const { openQuestion, answer } = question;
  const {
    pendingApprovals,
    readPendingApprovals,
    onDecideApproval,
    declineWith,
  } = decisions;
  // The message names the pick. Resolves to the fault the person sees, or null once it is sent.
  const chooseApproach = async (message: string): Promise<string | null> => {
    const currentOpen = openApprovalOf(await readPendingApprovals());
    return chooseApproachWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      deliver: () => composer.mail(message),
      decline: (approvalId) =>
        composer.mail(message, false, declineWith(approvalId)),
      notSent: wording.approaches.notSent,
    });
  };
  const deliver = async (body: string, clearComposer = false) => {
    if (body.trim().length === 0 || sending) return false;
    // While the coordinator waits on its question, whatever the person types is their answer.
    if (openQuestion !== undefined) {
      const sent = await answer(openQuestion.signalName, {
        reply: body.trim(),
      });
      if (sent && clearComposer) composer.setText("");
      return sent;
    }
    const currentOpen = openApprovalOf(await readPendingApprovals());
    return deliverWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      decide: onDecideApproval,
      deliver: () => composer.mail(body, clearComposer),
      decline: (approvalId) =>
        composer.mail(body, clearComposer, declineWith(approvalId)),
    });
  };
  const sendFiles = async () => {
    if (sending) return false;
    const currentOpen = openApprovalOf(await readPendingApprovals());
    return deliverWithOpenApproval({
      openApprovalId: currentOpen?.approvalId,
      decide: onDecideApproval,
      deliver: composer.sendFiles,
    });
  };
  const undoTypedYes = async (message: string) => {
    if (!(await deliver(message))) composer.restore(message);
  };
  const typedYes = useTypedYes({
    pending: pendingApprovals?.map((approval) => approval.approvalId),
    onApprove: (approvalId) =>
      void onDecideApproval({ approvalId, choice: "yes" }),
    onUndo: (message) => void undoTypedYes(message),
    onDropped: composer.restore,
  });
  const send = () => {
    if (composer.box.attachments.files.length > 0) return void sendFiles();
    if (typedYes.hold(composer.text)) return composer.setText("");
    void deliver(composer.text, true);
  };
  // The composer is disabled while the decline saves, so the cursor goes there once it can take it.
  const [changesAsked, setChangesAsked] = useState(false);
  const requestChanges = () => {
    setChangesAsked(true);
  };
  useEffect(() => {
    if (!changesAsked || composerDisabled) return;
    setChangesAsked(false);
    composer.inputRef.current?.focus();
  }, [changesAsked, composerDisabled]);

  return {
    /** Sends the words where they go now; resolves whether they went. */
    deliver,
    /** Sends what the box holds. */
    send,
    chooseApproach,
    typedYes,
    /** Takes the person to the box to say what should change instead. */
    requestChanges,
  };
}
