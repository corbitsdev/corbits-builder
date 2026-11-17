import { type } from "arktype";

// Who decides the project's approvals: the person, or Builder on their behalf.
const Decides = type("'person' | 'builder'");

// Who decides now, so the screen offers the other way.
export const Input = type({ "+": "reject", decides: Decides });

// Who decides from now on.
export const Output = type({ "+": "reject", decides: Decides });
