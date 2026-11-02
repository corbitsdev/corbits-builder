export { checkDeck, contrastRatio, relativeLuminance } from "./check.ts";
export {
  AssetRef,
  Block,
  Deck,
  Element,
  ImageElement,
  Link,
  List,
  ListItem,
  Paragraph,
  RichText,
  Run,
  Slide,
  TextBlock,
  Theme,
  ThemeColor,
  assetKey,
  freeElements,
  slideRegions,
  validateDeck,
  type DeckInput,
  type DeckIssue,
  type DeckValidation,
  type Layout,
} from "./deck.ts";
export { writeDeckPdf, writePdf } from "./pdf.ts";
export { DeckError, writePptx, type Assets } from "./write.ts";
