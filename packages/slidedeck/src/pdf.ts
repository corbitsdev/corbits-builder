import {
  writePdf as renderPdfPages,
  type PdfBorder,
  type PdfElement,
  type PdfPage,
  type PdfPaint,
  type PdfParagraph,
  type PdfRadius,
  type PdfTextRun,
} from "@corbits/pdf";

import { resolveThemeHex } from "./check.ts";
import {
  validateDeck,
  type Block,
  type Border,
  type Deck,
  type DeckInput,
  type FreeElement,
  type ListItem,
  type Paint,
  type PictureElement,
  type RichText,
  type ShapeElement,
  type Slide,
  type TextBlock,
  type TextElement,
  type Theme,
} from "./deck.ts";
import {
  FREE_AREA,
  LOGO_BOX,
  SLIDE_SIZE,
  layoutPlaceholders,
  type Box,
  type Placeholder,
  type Role,
} from "./layouts.ts";
import {
  DeckError,
  STACK_GAP,
  resolveMedia,
  segments,
  type Assets,
} from "./write.ts";

const EMU_PER_POINT = 12700;
const PX_TO_PT = 0.75;
const LIST_PT_SIZES = [20, 18, 16, 16, 16];
const LIST_BULLETS = ["•", "–", "•", "–", "•"];
const LIST_INDENT_PT = 24;

type MediaStore = ReturnType<typeof resolveMedia>;

function emuBoxToPt(box: Box) {
  return {
    x: box.x / EMU_PER_POINT,
    y: box.y / EMU_PER_POINT,
    w: box.w / EMU_PER_POINT,
    h: box.h / EMU_PER_POINT,
  };
}

function pxBoxToPt(box: Box) {
  return {
    x: box.x * PX_TO_PT,
    y: box.y * PX_TO_PT,
    w: box.w * PX_TO_PT,
    h: box.h * PX_TO_PT,
  };
}

function resolvePdfPaint(theme: Theme, paint: Paint): PdfPaint {
  if (typeof paint === "string") return resolveThemeHex(theme, paint);
  const stops = paint.stops.map((s) => ({
    color: resolveThemeHex(theme, s.color),
    at: s.at,
    ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
  }));
  if (paint.type === "radial") return { type: "radial", stops };
  return { type: "linear", angle: paint.angle, stops };
}

function resolvePdfBorder(
  theme: Theme,
  border: Border | undefined,
): PdfBorder | undefined {
  if (!border) return undefined;
  return {
    width: border.width * PX_TO_PT,
    color: resolveThemeHex(theme, border.color),
    dash: border.dash,
    ...(border.opacity !== undefined ? { opacity: border.opacity } : {}),
  };
}

function scaleRadius(radius: PdfRadius): PdfRadius {
  if (typeof radius === "number") return radius * PX_TO_PT;
  return [
    radius[0] * PX_TO_PT,
    radius[1] * PX_TO_PT,
    radius[2] * PX_TO_PT,
    radius[3] * PX_TO_PT,
  ];
}

function scaleRadiusToPt(
  radius: PictureElement["radius"],
): PdfRadius | undefined {
  if (radius === undefined) return undefined;
  return scaleRadius(radius);
}

function richRunsToPdf(
  theme: Theme,
  text: RichText,
  defaultSizePt: number,
  defaultColor: string,
  defaultBold = false,
): PdfTextRun[] {
  const list = typeof text === "string" ? [text] : text;
  return list.map((raw) => {
    if (typeof raw === "string") {
      return {
        text: raw,
        size: defaultSizePt,
        color: resolveThemeHex(theme, defaultColor),
        bold: defaultBold,
      };
    }
    return {
      text: raw.text,
      size: raw.size ?? defaultSizePt,
      color: resolveThemeHex(theme, raw.color ?? defaultColor),
      bold: raw.bold ?? defaultBold,
      ...(raw.italic !== undefined ? { italic: raw.italic } : {}),
      ...(raw.underline !== undefined ? { underline: raw.underline } : {}),
      ...(raw.strike !== undefined ? { strike: raw.strike } : {}),
      ...(raw.link !== undefined ? { link: raw.link } : {}),
    };
  });
}

function formatMarker(ordered: boolean, level: number, index: number): string {
  if (!ordered) return LIST_BULLETS[level - 1] ?? "•";
  if (level % 2 === 0) {
    const letter = String.fromCharCode(97 + (index % 26));
    return `${letter}.`;
  }
  return `${index + 1}.`;
}

function* listToPdfParagraphs(
  theme: Theme,
  items: readonly ListItem[],
  ordered: boolean,
  level: number,
): Generator<PdfParagraph> {
  const sizePt = LIST_PT_SIZES[level - 1] ?? 16;
  const indent = level * LIST_INDENT_PT;
  const bulletColor = resolveThemeHex(theme, "primary");
  for (const [idx, item] of items.entries()) {
    const bullet = formatMarker(ordered, level, idx);
    if (typeof item === "string" || Array.isArray(item)) {
      yield {
        runs: richRunsToPdf(theme, item, sizePt, "text"),
        indent,
        bullet,
        bulletColor,
        spaceBefore: 4,
      };
      continue;
    }
    yield {
      runs: richRunsToPdf(theme, item.text, sizePt, "text"),
      indent,
      bullet,
      bulletColor,
      spaceBefore: 4,
    };
    yield* listToPdfParagraphs(
      theme,
      item.items,
      item.ordered ?? ordered,
      level + 1,
    );
  }
}

function textBlocksToPdfParagraphs(
  theme: Theme,
  blocks: readonly TextBlock[],
): PdfParagraph[] {
  const out: PdfParagraph[] = [];
  for (const [idx, block] of blocks.entries()) {
    if (block.type === "paragraph") {
      out.push({
        runs: richRunsToPdf(theme, block.text, 20, "text"),
        spaceBefore: idx === 0 ? 0 : 6,
      });
    } else {
      out.push(...listToPdfParagraphs(theme, block.items, block.ordered, 1));
    }
  }
  return out;
}

function mapAnchor(anchor: Placeholder["anchor"]): "top" | "middle" | "bottom" {
  if (anchor === "ctr") return "middle";
  if (anchor === "b") return "bottom";
  return "top";
}

function mapAlign(align: Placeholder["align"]): "left" | "center" | "right" {
  if (align === "ctr") return "center";
  if (align === "r") return "right";
  return "left";
}

function schemeColorToToken(scheme: string | undefined): string {
  if (scheme === "tx2") return "muted";
  if (scheme === "accent1") return "primary";
  return "text";
}

function placeholderTextElement(
  theme: Theme,
  ph: Placeholder,
  text: string,
): PdfElement {
  const box = emuBoxToPt(ph.box);
  const sizePt = ph.size ? ph.size / 100 : 32;
  const bold = ph.bold ?? (ph.kind === "title" || ph.kind === "ctrTitle");
  const token = schemeColorToToken(ph.color);
  return {
    type: "text",
    ...box,
    anchor: mapAnchor(ph.anchor),
    align: mapAlign(ph.align),
    paragraphs: [
      {
        align: mapAlign(ph.align),
        runs: richRunsToPdf(theme, text, sizePt, token, bold),
      },
    ],
  };
}

function stackRegionElements(
  theme: Theme,
  media: MediaStore,
  blocks: readonly Block[],
  area: Box,
): PdfElement[] {
  if (blocks.length === 0) return [];
  const bands = segments(blocks);
  const bandHeight = Math.round(
    (area.h - STACK_GAP * (bands.length - 1)) / bands.length,
  );
  const elements: PdfElement[] = [];
  for (const [idx, band] of bands.entries()) {
    const bandBox = emuBoxToPt({
      ...area,
      y: area.y + idx * (bandHeight + STACK_GAP),
      h: bandHeight,
    });
    if ("element" in band) {
      const data = media.get(band.element.image).data;
      elements.push({
        type: "image",
        ...bandBox,
        data,
        fit: band.element.fit,
      });
    } else {
      elements.push({
        type: "text",
        ...bandBox,
        paragraphs: textBlocksToPdfParagraphs(theme, band.text),
      });
    }
  }
  return elements;
}

function renderShapeElement(
  theme: Theme,
  el: ShapeElement,
  opacity: number,
): PdfElement {
  const box = pxBoxToPt(el);
  const border = resolvePdfBorder(theme, el.border);
  if (el.geometry === "line") {
    const x1 = el.flip === "horizontal" ? box.x + box.w : box.x;
    const x2 = el.flip === "horizontal" ? box.x : box.x + box.w;
    const y1 = el.flip === "vertical" ? box.y + box.h : box.y;
    const y2 = el.flip === "vertical" ? box.y : box.y + box.h;
    return {
      type: "line",
      x1,
      y1,
      x2,
      y2,
      width: el.border.width * PX_TO_PT,
      color: resolveThemeHex(theme, el.border.color),
      dash: el.border.dash,
      opacity: opacity * (el.border.opacity ?? 1),
    };
  }
  const fill = el.fill ? resolvePdfPaint(theme, el.fill) : undefined;
  if (el.geometry === "ellipse") {
    return {
      type: "ellipse",
      ...box,
      opacity,
      ...(fill !== undefined ? { fill } : {}),
      ...(border !== undefined ? { border } : {}),
    };
  }
  if (el.geometry === "roundRect") {
    return {
      type: "roundRect",
      ...box,
      radius: scaleRadius(el.radius),
      opacity,
      ...(fill !== undefined ? { fill } : {}),
      ...(border !== undefined ? { border } : {}),
    };
  }
  return {
    type: "rect",
    ...box,
    opacity,
    ...(fill !== undefined ? { fill } : {}),
    ...(border !== undefined ? { border } : {}),
  };
}

function renderFreeTextElement(
  theme: Theme,
  el: TextElement,
  opacity: number,
): PdfElement {
  const box = pxBoxToPt(el);
  const fill = el.fill ? resolvePdfPaint(theme, el.fill) : undefined;
  const border = resolvePdfBorder(theme, el.border);
  const insets = el.insets
    ? {
        top: el.insets.top * PX_TO_PT,
        right: el.insets.right * PX_TO_PT,
        bottom: el.insets.bottom * PX_TO_PT,
        left: el.insets.left * PX_TO_PT,
      }
    : undefined;
  const paragraphs: PdfParagraph[] = el.paragraphs.map((p) => ({
    align: p.align,
    ...(p.lineHeight !== undefined
      ? { lineHeight: p.lineHeight * PX_TO_PT }
      : {}),
    spaceBefore: p.spaceBefore * PX_TO_PT,
    spaceAfter: p.spaceAfter * PX_TO_PT,
    runs: p.runs.map((r): PdfTextRun => {
      if (typeof r === "string") {
        return {
          text: r,
          size: 18 * PX_TO_PT,
          color: resolveThemeHex(theme, "text"),
        };
      }
      return {
        text: r.text,
        size: (r.size ?? 18) * PX_TO_PT,
        color: r.color
          ? resolvePdfPaint(theme, r.color)
          : resolveThemeHex(theme, "text"),
        bold: (r.weight ?? 400) >= 600,
        ...(r.italic !== undefined ? { italic: r.italic } : {}),
        ...(r.underline !== undefined ? { underline: r.underline } : {}),
        ...(r.strike !== undefined ? { strike: r.strike } : {}),
        ...(r.letterSpacing !== undefined
          ? { letterSpacing: r.letterSpacing * PX_TO_PT }
          : {}),
        ...(r.link !== undefined ? { link: r.link } : {}),
      };
    }),
  }));

  return {
    type: "text",
    ...box,
    anchor: el.anchor,
    wrap: el.wrap,
    opacity,
    paragraphs,
    ...(insets !== undefined ? { insets } : {}),
    ...(fill !== undefined ? { fill } : {}),
    ...(border !== undefined ? { border } : {}),
  };
}

function renderPictureElement(
  theme: Theme,
  media: MediaStore,
  el: PictureElement,
  opacity: number,
): PdfElement {
  const box = pxBoxToPt(el);
  const data = media.get(el.image).data;
  const radius = scaleRadiusToPt(el.radius);
  const border = resolvePdfBorder(theme, el.border);
  return {
    type: "image",
    ...box,
    data,
    fit: el.fit,
    opacity,
    ...(el.crop !== undefined ? { crop: el.crop } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(border !== undefined ? { border } : {}),
  };
}

function collectFreeElements(
  theme: Theme,
  media: MediaStore,
  elements: readonly FreeElement[],
  inheritedOpacity = 1,
): PdfElement[] {
  const out: PdfElement[] = [];
  for (const el of elements) {
    const opacity = inheritedOpacity * (el.opacity ?? 1);
    if (el.type === "group") {
      out.push(...collectFreeElements(theme, media, el.children, opacity));
    } else if (el.type === "shape") {
      out.push(renderShapeElement(theme, el, opacity));
    } else if (el.type === "text") {
      out.push(renderFreeTextElement(theme, el, opacity));
    } else {
      out.push(renderPictureElement(theme, media, el, opacity));
    }
  }
  return out;
}

function singleTextsForSlide(
  deck: Deck,
  slide: Exclude<Slide, { layout: "free" }>,
  index: number,
): Partial<Record<Role, string>> {
  const footer: Partial<Record<Role, string>> = {
    ...(deck.footer?.text ? { footer: deck.footer.text } : {}),
    ...(deck.footer?.slideNumbers ? { slideNumber: String(index + 1) } : {}),
  };
  switch (slide.layout) {
    case "title":
    case "section":
      return {
        ...footer,
        title: slide.title,
        ...(slide.subtitle ? { subtitle: slide.subtitle } : {}),
      };
    case "comparison":
      return {
        ...footer,
        title: slide.title,
        leftHeading: slide.left.heading,
        rightHeading: slide.right.heading,
      };
    case "image":
      return {
        ...footer,
        ...(slide.title ? { title: slide.title } : {}),
        ...(slide.caption ? { caption: slide.caption } : {}),
      };
    case "blank":
      return footer;
    default:
      return { ...footer, title: slide.title };
  }
}

function renderPlacedSlide(
  deck: Deck,
  media: MediaStore,
  slide: Exclude<Slide, { layout: "free" }>,
  index: number,
): PdfPage {
  const elements: PdfElement[] = [];
  if (deck.theme.logo) {
    elements.push({
      type: "image",
      ...emuBoxToPt(LOGO_BOX),
      data: media.get(deck.theme.logo).data,
      fit: "contain",
    });
  }

  const singleTexts = singleTextsForSlide(deck, slide, index);
  const byRole = new Map<Role, Placeholder>(
    layoutPlaceholders(slide.layout).map((ph) => [ph.role, ph]),
  );

  if (slide.layout === "image") {
    const ph = byRole.get("image");
    const box =
      slide.fit === "cover" && slide.title === undefined
        ? { x: 0, y: 0, ...SLIDE_SIZE }
        : (ph?.box ?? FREE_AREA);
    elements.push({
      type: "image",
      ...emuBoxToPt(box),
      data: media.get(slide.image).data,
      fit: slide.fit,
    });
  }

  if (slide.layout === "blank") {
    elements.push(
      ...stackRegionElements(deck.theme, media, slide.body, FREE_AREA),
    );
  } else if (slide.layout === "content") {
    const ph = byRole.get("body");
    if (ph)
      elements.push(
        ...stackRegionElements(deck.theme, media, slide.body, ph.box),
      );
  } else if (slide.layout === "two-column") {
    const leftPh = byRole.get("left");
    const rightPh = byRole.get("right");
    if (leftPh)
      elements.push(
        ...stackRegionElements(deck.theme, media, slide.left, leftPh.box),
      );
    if (rightPh)
      elements.push(
        ...stackRegionElements(deck.theme, media, slide.right, rightPh.box),
      );
  } else if (slide.layout === "comparison") {
    const leftPh = byRole.get("left");
    const rightPh = byRole.get("right");
    if (leftPh)
      elements.push(
        ...stackRegionElements(deck.theme, media, slide.left.body, leftPh.box),
      );
    if (rightPh)
      elements.push(
        ...stackRegionElements(
          deck.theme,
          media,
          slide.right.body,
          rightPh.box,
        ),
      );
  }

  for (const ph of layoutPlaceholders(slide.layout)) {
    const value = singleTexts[ph.role];
    if (value !== undefined)
      elements.push(placeholderTextElement(deck.theme, ph, value));
  }

  return {
    width: SLIDE_SIZE.w / EMU_PER_POINT,
    height: SLIDE_SIZE.h / EMU_PER_POINT,
    background: resolveThemeHex(deck.theme, "background"),
    elements,
  };
}

/**
 * Renders a validated deck to a 16:9 PDF 1.4 document. Throws `DeckError` if
 * the deck or its referenced image assets are invalid.
 */
export function writePdf(
  input: DeckInput,
  assets: Assets = new Map(),
): Uint8Array<ArrayBuffer> {
  const checked = validateDeck(input);
  if (!checked.ok) throw new DeckError(checked.issues);
  const { deck } = checked;
  const media = resolveMedia(deck, assets);

  const pages: PdfPage[] = deck.slides.map((slide, index) => {
    if (slide.layout === "free") {
      return {
        width: SLIDE_SIZE.w / EMU_PER_POINT,
        height: SLIDE_SIZE.h / EMU_PER_POINT,
        background: slide.background
          ? resolvePdfPaint(deck.theme, slide.background)
          : resolveThemeHex(deck.theme, "background"),
        elements: collectFreeElements(deck.theme, media, slide.elements),
      };
    }
    return renderPlacedSlide(deck, media, slide, index);
  });

  return renderPdfPages(pages);
}

export const writeDeckPdf = writePdf;
