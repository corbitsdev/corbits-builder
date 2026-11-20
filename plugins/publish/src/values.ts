import {
  HOLDING,
  KEEP,
  PLAN,
  RELEASE,
  TAKE_DOWN,
} from "@corbits-builder/publishing";
import { GO_AHEAD } from "./go-ahead.ts";

// Every place records where the app is under these, so the publish plugin declares them once.
export default [RELEASE, PLAN, GO_AHEAD, KEEP, HOLDING, TAKE_DOWN];
