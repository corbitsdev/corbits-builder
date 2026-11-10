/** The invitation accept screen, at the invitation's own URL. */
import {
  useInvitationAccept,
  type InvitationAcceptProps,
} from "./invite-accept.model.ts";
import { InvitationAcceptView } from "./invite-accept.view.tsx";

export function InvitationAccept(props: InvitationAcceptProps) {
  return <InvitationAcceptView {...useInvitationAccept(props)} />;
}
