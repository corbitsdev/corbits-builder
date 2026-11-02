import { measureTextWidth } from "@corbits/pdf";

import {
  assetKey,
  freeElements,
  slideRegions,
  validateDeck,
  type Deck,
  type DeckIssue,
  type FreeParagraph,
  type ListItem,
  type Paint,
  type RichText,
  type Run,
  type Slide,
  type TextBlock,
  type TextElement,
  type Theme,
  type ThemeColor,
} from "./deck.ts";
import { isSvg, readImage } from "./image.ts";
import {
  FREE_AREA,
  layoutPlaceholders,
  type Box,
  type Placeholder,
  type Role,
} from "./layouts.ts";
import {
  STACK_GAP,
  assetUses,
  segments,
  type AssetUse,
  type Assets,
} from "./write.ts";

const EMU_PER_POINT = 12700;
const LIST_PT_SIZES = [20, 18, 16, 16, 16];
const LIST_INDENT_PT = 25;
const PLACEHOLDER_PAD_X = 14;

const THEME_KEYS = new Set<ThemeColor>([
  "primary",
  "secondary",
  "accent",
  "background",
  "text",
  "muted",
]);

function isThemeColor(value: string): value is ThemeColor {
  return THEME_KEYS.has(value as ThemeColor);
}

export function resolveThemeHex(theme: Theme, color: string): string {
  const raw = isThemeColor(color) ? theme.colors[color] : color;
  return raw.startsWith("#") ? raw.toUpperCase() : `#${raw.toUpperCase()}`;
}

export function resolvePaintHex(theme: Theme, paint: Paint): string {
  if (typeof paint === "string") return resolveThemeHex(theme, paint);
  const first = paint.stops[0];
  if (!first) return resolveThemeHex(theme, "background");
  return resolveThemeHex(theme, first.color);
}

function srgbChannelLuminance(byte: number): number {
  const s = byte / 255;
  if (s <= 0.04045) return s / 12.92;
  return ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelLuminance(r) +
    0.7152 * srgbChannelLuminance(g) +
    0.0722 * srgbChannelLuminance(b)
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function formatPathSegment(key: string | number, index: number): string {
  if (typeof key === "number") return `[${key}]`;
  if (index === 0) return key;
  return `.${key}`;
}

function formatPath(path: readonly (string | number)[]): string {
  return path.map(formatPathSegment).join("");
}

function slideIssue(slide: number, path: string, detail: string): DeckIssue {
  return { slide, path, message: `${path} ${detail}` };
}

function assetIssue(use: AssetUse, message: string): DeckIssue {
  if (use.slide === undefined) return { path: use.path, message };
  return { slide: use.slide, path: use.path, message };
}

function checkMedia(deck: Deck, assets: Assets): DeckIssue[] {
  const issues: DeckIssue[] = [];
  for (const use of assetUses(deck)) {
    const data = assets.get(assetKey(use.ref));
    if (!data) {
      issues.push(
        assetIssue(
          use,
          `${use.path} names asset "${assetKey(use.ref)}", which was not provided`,
        ),
      );
      continue;
    }
    if (use.svg) {
      if (!isSvg(data))
        issues.push(assetIssue(use, `${use.path} is not an SVG image`));
      continue;
    }
    if (!readImage(data))
      issues.push(
        assetIssue(use, `${use.path} is not a PNG or JPEG image with a size`),
      );
  }
  return issues;
}

function richRuns(text: RichText): Run[] {
  const list = typeof text === "string" ? [text] : text;
  return list.map((run) => (typeof run === "string" ? { text: run } : run));
}

function richTextPlain(text: RichText): string {
  return richRuns(text)
    .map((r) => r.text)
    .join("");
}

function checkListEmpty(
  slide: number,
  items: readonly ListItem[],
  basePath: string,
  issues: DeckIssue[],
) {
  for (const [idx, item] of items.entries()) {
    const itemPath = `${basePath}[${idx}]`;
    if (typeof item === "string" || Array.isArray(item)) {
      if (richTextPlain(item).trim() === "")
        issues.push(slideIssue(slide, itemPath, "has empty list item text"));
      continue;
    }
    if (richTextPlain(item.text).trim() === "")
      issues.push(
        slideIssue(slide, `${itemPath}.text`, "has empty list item text"),
      );
    checkListEmpty(slide, item.items, `${itemPath}.items`, issues);
  }
}

function checkEmptySlide(slide: Slide, index: number): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const base = `slides[${index}]`;
  if (
    "title" in slide &&
    slide.title !== undefined &&
    slide.title.trim() === ""
  )
    issues.push(slideIssue(index, `${base}.title`, "has an empty title"));
  if (
    "subtitle" in slide &&
    slide.subtitle !== undefined &&
    slide.subtitle.trim() === ""
  )
    issues.push(slideIssue(index, `${base}.subtitle`, "has an empty subtitle"));
  if (
    slide.layout === "image" &&
    slide.caption !== undefined &&
    slide.caption.trim() === ""
  )
    issues.push(slideIssue(index, `${base}.caption`, "has an empty caption"));
  if (slide.layout === "comparison") {
    if (slide.left.heading.trim() === "")
      issues.push(
        slideIssue(index, `${base}.left.heading`, "has an empty heading"),
      );
    if (slide.right.heading.trim() === "")
      issues.push(
        slideIssue(index, `${base}.right.heading`, "has an empty heading"),
      );
  }

  for (const region of slideRegions(slide)) {
    const regionPath = `${base}.${region.path}`;
    if (region.blocks.length === 0) {
      issues.push(
        slideIssue(index, regionPath, "is empty; add at least one block"),
      );
      continue;
    }
    for (const [bIdx, block] of region.blocks.entries()) {
      const bPath = `${regionPath}[${bIdx}]`;
      if (block.type === "paragraph") {
        if (richTextPlain(block.text).trim() === "")
          issues.push(
            slideIssue(index, `${bPath}.text`, "has an empty paragraph"),
          );
      } else if (block.type === "list") {
        checkListEmpty(index, block.items, `${bPath}.items`, issues);
      }
    }
  }

  if (slide.layout === "free") {
    if (slide.elements.length === 0) {
      issues.push(
        slideIssue(
          index,
          `${base}.elements`,
          "is empty; add at least one element",
        ),
      );
      return issues;
    }
    for (const [el, path] of freeElements(slide.elements, [
      "slides",
      index,
      "elements",
    ])) {
      if (el.type !== "text") continue;
      const elPath = formatPath(path);
      const combined = el.paragraphs
        .flatMap((p) => p.runs.map((r) => (typeof r === "string" ? r : r.text)))
        .join("");
      if (combined.trim() === "")
        issues.push(
          slideIssue(index, `${elPath}.paragraphs`, "has empty text"),
        );
    }
  }
  return issues;
}

function estimateWrappedLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  bold = false,
  letterSpacing = 0,
): number {
  if (maxWidth <= 0) return 1;
  const hardLines = text.split(/\r?\n/);
  let total = 0;
  for (const line of hardLines) {
    const width = measureTextWidth(line, fontSize, bold, letterSpacing);
    total += Math.max(1, Math.ceil(width / maxWidth));
  }
  return Math.max(1, total);
}

function estimateRichParagraphHeightPt(
  text: RichText,
  defaultSizePt: number,
  availWidthPt: number,
  boldDefault = false,
  spaceBeforePt = 6,
): number {
  const runs = richRuns(text);
  let maxSize = defaultSizePt;
  for (const r of runs) if (r.size && r.size > maxSize) maxSize = r.size;
  const plain = runs.map((r) => r.text).join("");
  const anyBold = boldDefault || runs.some((r) => r.bold);
  const lines = estimateWrappedLines(plain, maxSize, availWidthPt, anyBold, 0);
  return spaceBeforePt + (lines - 1) * maxSize * 1.2 + maxSize * 0.95;
}

function* flattenListItems(
  items: readonly ListItem[],
  level: number,
): Generator<{ text: RichText; level: number }> {
  for (const item of items) {
    if (typeof item === "string" || Array.isArray(item)) {
      yield { text: item, level };
      continue;
    }
    yield { text: item.text, level };
    yield* flattenListItems(item.items, level + 1);
  }
}

function estimateTextBandHeightPt(
  blocks: readonly TextBlock[],
  boxWidthPt: number,
): number {
  const contentWidth = Math.max(20, boxWidthPt - PLACEHOLDER_PAD_X);
  let height = 0;
  for (const [idx, block] of blocks.entries()) {
    const spaceBefore = idx === 0 ? 0 : 6;
    if (block.type === "paragraph") {
      height += estimateRichParagraphHeightPt(
        block.text,
        20,
        contentWidth,
        false,
        spaceBefore,
      );
      continue;
    }
    for (const [itemIdx, item] of [
      ...flattenListItems(block.items, 1),
    ].entries()) {
      const levelSize = LIST_PT_SIZES[item.level - 1] ?? 16;
      const itemWidth = Math.max(
        20,
        contentWidth - item.level * LIST_INDENT_PT,
      );
      const itemSpace = idx === 0 && itemIdx === 0 ? 0 : 4;
      height += estimateRichParagraphHeightPt(
        item.text,
        levelSize,
        itemWidth,
        false,
        itemSpace,
      );
    }
  }
  return height;
}

function checkLayoutOverflow(
  slide: Exclude<Slide, { layout: "free" }>,
  index: number,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const base = `slides[${index}]`;
  const byRole = new Map<Role, Placeholder>(
    layoutPlaceholders(slide.layout).map((ph) => [ph.role, ph]),
  );

  const checkSingleText = (
    role: Role,
    fieldPath: string,
    value: string | undefined,
    defaultSizePt: number,
    bold = false,
  ) => {
    if (!value) return;
    const ph = byRole.get(role);
    if (!ph) return;
    const widthPt = Math.max(20, ph.box.w / EMU_PER_POINT - PLACEHOLDER_PAD_X);
    const heightPt = ph.box.h / EMU_PER_POINT;
    const sizePt = ph.size ? ph.size / 100 : defaultSizePt;
    const needed = estimateRichParagraphHeightPt(
      value,
      sizePt,
      widthPt,
      ph.bold ?? bold,
      0,
    );
    if (needed > heightPt)
      issues.push(
        slideIssue(
          index,
          `${base}.${fieldPath}`,
          `overflows its placeholder box (${Math.round(needed)}pt > ${Math.round(heightPt)}pt)`,
        ),
      );
  };

  if ("title" in slide)
    checkSingleText("title", "title", slide.title, 32, true);
  if ("subtitle" in slide)
    checkSingleText("subtitle", "subtitle", slide.subtitle, 20);
  if (slide.layout === "image")
    checkSingleText("caption", "caption", slide.caption, 14);
  if (slide.layout === "comparison") {
    checkSingleText(
      "leftHeading",
      "left.heading",
      slide.left.heading,
      20,
      true,
    );
    checkSingleText(
      "rightHeading",
      "right.heading",
      slide.right.heading,
      20,
      true,
    );
  }

  for (const region of slideRegions(slide)) {
    if (region.blocks.length === 0) continue;
    const area: Box =
      slide.layout === "blank"
        ? FREE_AREA
        : (byRole.get(region.role)?.box ?? FREE_AREA);
    const bands = segments(region.blocks);
    const bandHeightEmu =
      (area.h - STACK_GAP * (bands.length - 1)) / bands.length;
    const bandHeightPt = bandHeightEmu / EMU_PER_POINT;
    const bandWidthPt = area.w / EMU_PER_POINT;
    for (const band of bands) {
      if (!("text" in band)) continue;
      const needed = estimateTextBandHeightPt(band.text, bandWidthPt);
      if (needed > bandHeightPt) {
        issues.push(
          slideIssue(
            index,
            `${base}.${region.path}`,
            `overflows its content box (${Math.round(needed)}pt > ${Math.round(bandHeightPt)}pt)`,
          ),
        );
        break;
      }
    }
  }
  return issues;
}

function estimateFreeParagraphHeightPx(
  para: FreeParagraph,
  innerW: number,
  wrap: boolean,
): { height: number; widerThanBox: boolean } {
  const runs = para.runs.map((r) => (typeof r === "string" ? { text: r } : r));
  let maxSize = 18;
  let maxSpacing = 0;
  let anyBold = false;
  for (const r of runs) {
    if (r.size !== undefined && r.size > maxSize) maxSize = r.size;
    if (r.letterSpacing !== undefined && r.letterSpacing > maxSpacing)
      maxSpacing = r.letterSpacing;
    if (r.weight !== undefined && r.weight >= 600) anyBold = true;
  }
  const plain = runs.map((r) => r.text).join("");
  const hardLines = plain.split(/\r?\n/);
  let widerThanBox = false;
  let lineCount = 0;
  for (const line of hardLines) {
    const lineW = measureTextWidth(line, maxSize, anyBold, maxSpacing);
    if (!wrap) {
      lineCount += 1;
      if (lineW > innerW) widerThanBox = true;
    } else {
      lineCount += Math.max(1, Math.ceil(lineW / Math.max(1, innerW)));
    }
  }
  const lineHeight = para.lineHeight ?? maxSize * 1.2;
  const textHeight =
    lineCount > 0 ? (lineCount - 1) * lineHeight + maxSize * 0.85 : 0;
  return {
    height: para.spaceBefore + textHeight + para.spaceAfter,
    widerThanBox,
  };
}

function checkFreeTextOverflow(
  el: TextElement,
  index: number,
  elPath: string,
): DeckIssue | undefined {
  const insets = el.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const innerW = el.w - insets.left - insets.right;
  const innerH = el.h - insets.top - insets.bottom;
  if (innerW <= 0 || innerH <= 0)
    return slideIssue(index, elPath, "overflows its empty bounding box");

  let totalHeight = 0;
  for (const para of el.paragraphs) {
    const est = estimateFreeParagraphHeightPx(para, innerW, el.wrap);
    if (est.widerThanBox)
      return slideIssue(index, elPath, "overflows its horizontal bounding box");
    totalHeight += est.height;
  }
  if (totalHeight > innerH)
    return slideIssue(
      index,
      elPath,
      `overflows its bounding box (${Math.round(totalHeight)}px > ${Math.round(innerH)}px)`,
    );
  return undefined;
}

function checkOverflowSlide(slide: Slide, index: number): DeckIssue[] {
  if (slide.layout !== "free") return checkLayoutOverflow(slide, index);
  const issues: DeckIssue[] = [];
  for (const [el, path] of freeElements(slide.elements, [
    "slides",
    index,
    "elements",
  ])) {
    if (el.type !== "text") continue;
    const elPath = formatPath(path);
    const issue = checkFreeTextOverflow(el, index, elPath);
    if (issue) issues.push(issue);
  }
  return issues;
}

function minContrastFor(sizePt: number, bold: boolean): number {
  if (sizePt >= 24 || (sizePt >= 18.66 && bold)) return 3.0;
  return 4.5;
}

function checkColorContrast(
  slide: number,
  path: string,
  fgHex: string,
  bgCandidates: readonly string[],
  sizePt: number,
  bold: boolean,
): DeckIssue | undefined {
  const required = minContrastFor(sizePt, bold);
  const best = Math.max(...bgCandidates.map((bg) => contrastRatio(fgHex, bg)));
  if (best < required) {
    return slideIssue(
      slide,
      path,
      `has low contrast (${best.toFixed(2)}:1 < ${required}:1)`,
    );
  }
  return undefined;
}

function checkRichTextContrast(
  theme: Theme,
  slide: number,
  text: RichText,
  basePath: string,
  defaultColor: ThemeColor,
  defaultSizePt: number,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const bgHex = resolveThemeHex(theme, "background");
  for (const [idx, run] of richRuns(text).entries()) {
    if (run.text.trim() === "") continue;
    const fgHex = resolveThemeHex(theme, run.color ?? defaultColor);
    const sizePt = run.size ?? defaultSizePt;
    const runPath = typeof text === "string" ? basePath : `${basePath}[${idx}]`;
    const issue = checkColorContrast(
      slide,
      runPath,
      fgHex,
      [bgHex],
      sizePt,
      run.bold ?? false,
    );
    if (issue) issues.push(issue);
  }
  return issues;
}

function checkListContrast(
  theme: Theme,
  slide: number,
  items: readonly ListItem[],
  basePath: string,
  level: number,
  issues: DeckIssue[],
) {
  const levelSize = LIST_PT_SIZES[level - 1] ?? 16;
  for (const [idx, item] of items.entries()) {
    const itemPath = `${basePath}[${idx}]`;
    if (typeof item === "string" || Array.isArray(item)) {
      issues.push(
        ...checkRichTextContrast(
          theme,
          slide,
          item,
          itemPath,
          "text",
          levelSize,
        ),
      );
      continue;
    }
    issues.push(
      ...checkRichTextContrast(
        theme,
        slide,
        item.text,
        `${itemPath}.text`,
        "text",
        levelSize,
      ),
    );
    checkListContrast(
      theme,
      slide,
      item.items,
      `${itemPath}.items`,
      level + 1,
      issues,
    );
  }
}

function coveringBackgroundsForFreeText(
  theme: Theme,
  slide: Slide & { layout: "free" },
  target: TextElement,
): string[] {
  if (target.fill !== undefined) return [resolvePaintHex(theme, target.fill)];
  const slideBg = slide.background
    ? resolvePaintHex(theme, slide.background)
    : resolveThemeHex(theme, "background");
  const candidates = new Set<string>([slideBg]);
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  for (const [el] of freeElements(slide.elements, [])) {
    if (el === target) break;
    if (el.type === "shape" && "fill" in el && el.fill !== undefined) {
      if (cx >= el.x && cx <= el.x + el.w && cy >= el.y && cy <= el.y + el.h)
        candidates.add(resolvePaintHex(theme, el.fill));
    }
  }
  return [...candidates];
}

function paintCandidateHexes(theme: Theme, paint: Paint | undefined): string[] {
  if (paint === undefined) return [resolveThemeHex(theme, "text")];
  if (typeof paint === "string") return [resolveThemeHex(theme, paint)];
  return paint.stops.map((s) => resolveThemeHex(theme, s.color));
}

function checkFreeSlideContrast(
  theme: Theme,
  slide: Slide & { layout: "free" },
  index: number,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  for (const [el, path] of freeElements(slide.elements, [
    "slides",
    index,
    "elements",
  ])) {
    if (el.type !== "text") continue;
    const elPath = formatPath(path);
    const bgs = coveringBackgroundsForFreeText(theme, slide, el);
    for (const [pIdx, para] of el.paragraphs.entries()) {
      for (const [rIdx, rawRun] of para.runs.entries()) {
        const run = typeof rawRun === "string" ? { text: rawRun } : rawRun;
        if (run.text.trim() === "") continue;
        const sizePx = run.size ?? 18;
        const sizePt = sizePx * 0.75;
        const bold = (run.weight ?? 400) >= 600;
        const fgCandidates = paintCandidateHexes(theme, run.color);
        const bestFgBg = Math.max(
          ...fgCandidates.flatMap((fg) =>
            bgs.map((bg) => contrastRatio(fg, bg)),
          ),
        );
        const required = minContrastFor(sizePt, bold);
        if (bestFgBg < required) {
          issues.push(
            slideIssue(
              index,
              `${elPath}.paragraphs[${pIdx}].runs[${rIdx}]`,
              `has low contrast (${bestFgBg.toFixed(2)}:1 < ${required}:1)`,
            ),
          );
        }
      }
    }
  }
  return issues;
}

function checkContrastSlide(
  theme: Theme,
  slide: Slide,
  index: number,
): DeckIssue[] {
  if (slide.layout === "free")
    return checkFreeSlideContrast(theme, slide, index);
  const issues: DeckIssue[] = [];
  const base = `slides[${index}]`;
  const bgHex = resolveThemeHex(theme, "background");

  const addContrast = (
    path: string,
    token: ThemeColor,
    sizePt: number,
    bold: boolean,
  ) => {
    const issue = checkColorContrast(
      index,
      path,
      resolveThemeHex(theme, token),
      [bgHex],
      sizePt,
      bold,
    );
    if (issue) issues.push(issue);
  };

  if ("title" in slide && slide.title && slide.title.trim() !== "")
    addContrast(`${base}.title`, "text", 32, true);
  if ("subtitle" in slide && slide.subtitle && slide.subtitle.trim() !== "")
    addContrast(`${base}.subtitle`, "muted", 20, false);
  if (slide.layout === "image" && slide.caption && slide.caption.trim() !== "")
    addContrast(`${base}.caption`, "muted", 14, false);
  if (slide.layout === "comparison") {
    addContrast(`${base}.left.heading`, "primary", 20, true);
    addContrast(`${base}.right.heading`, "primary", 20, true);
  }

  for (const region of slideRegions(slide)) {
    const regionPath = `${base}.${region.path}`;
    for (const [bIdx, block] of region.blocks.entries()) {
      const bPath = `${regionPath}[${bIdx}]`;
      if (block.type === "paragraph") {
        issues.push(
          ...checkRichTextContrast(
            theme,
            index,
            block.text,
            `${bPath}.text`,
            "text",
            20,
          ),
        );
      } else if (block.type === "list") {
        checkListContrast(
          theme,
          index,
          block.items,
          `${bPath}.items`,
          1,
          issues,
        );
      }
    }
  }
  return issues;
}

/**
 * Deterministically checks a deck for schema validity, missing or corrupt
 * images, empty placeholders/blocks, text overflow and low contrast.
 */
export function checkDeck(
  input: unknown,
  assets: Assets = new Map(),
): DeckIssue[] {
  const validated = validateDeck(input);
  if (!validated.ok) return validated.issues;
  const { deck } = validated;
  const issues: DeckIssue[] = [...checkMedia(deck, assets)];
  for (const [index, slide] of deck.slides.entries()) {
    issues.push(
      ...checkEmptySlide(slide, index),
      ...checkOverflowSlide(slide, index),
      ...checkContrastSlide(deck.theme, slide, index),
    );
  }
  return issues;
}
