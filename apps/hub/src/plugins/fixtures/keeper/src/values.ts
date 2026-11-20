import { LinkValue, defineValue } from "@corbits-builder/plugin";

export const KEEP = defineValue(
  "keeper.keep",
  LinkValue,
  "The link that hands the published app's account to the person.",
  { private: true },
);

export const ADDRESS = defineValue(
  "keeper.address",
  LinkValue,
  "Where the published app answers.",
);

export default [KEEP, ADDRESS];
