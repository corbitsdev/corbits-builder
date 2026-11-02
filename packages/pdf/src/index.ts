import { decodePdfImage, type PdfDecodedImage } from "./image.ts";
import { PdfError, adler32, deflateZlib, inflateZlib } from "./zlib.ts";

export {
  PdfError,
  adler32,
  decodePdfImage,
  deflateZlib,
  inflateZlib,
  type PdfDecodedImage,
};

export type PdfRgb = readonly [number, number, number];
export type PdfColor = string | PdfRgb;

export type PdfGradientStop = {
  color: PdfColor;
  at: number;
  opacity?: number;
};

export type PdfPaint =
  | PdfColor
  | {
      type: "linear";
      angle?: number;
      stops: readonly PdfGradientStop[];
    }
  | {
      type: "radial";
      stops: readonly PdfGradientStop[];
    };

export type PdfFontName =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique";

export type PdfBorder = {
  width: number;
  color: PdfColor;
  opacity?: number;
  dash?: "solid" | "dash" | "dot";
};

export type PdfRadius = number | readonly [number, number, number, number];

export type PdfTextRun = {
  text: string;
  font?: PdfFontName;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number;
  color?: PdfPaint;
  letterSpacing?: number;
  link?: string | number;
};

export type PdfParagraph = {
  runs: readonly (string | PdfTextRun)[];
  align?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  indent?: number;
  bullet?: string;
  bulletColor?: PdfColor;
};

export type PdfRectElement = {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: PdfRadius;
  fill?: PdfPaint;
  border?: PdfBorder;
  opacity?: number;
};

export type PdfRoundRectElement = {
  type: "roundRect";
  x: number;
  y: number;
  w: number;
  h: number;
  radius: PdfRadius;
  fill?: PdfPaint;
  border?: PdfBorder;
  opacity?: number;
};

export type PdfEllipseElement = {
  type: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: PdfPaint;
  border?: PdfBorder;
  opacity?: number;
};

export type PdfLineElement = {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
  color?: PdfColor;
  dash?: "solid" | "dash" | "dot";
  opacity?: number;
};

export type PdfTextElement = {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  runs?: readonly (string | PdfTextRun)[];
  paragraphs?: readonly PdfParagraph[];
  size?: number;
  font?: PdfFontName;
  bold?: boolean;
  italic?: boolean;
  color?: PdfPaint;
  align?: "left" | "center" | "right" | "justify";
  anchor?: "top" | "middle" | "bottom";
  wrap?: boolean;
  insets?: { top: number; right: number; bottom: number; left: number };
  fill?: PdfPaint;
  border?: PdfBorder;
  opacity?: number;
};

export type PdfImageElement = {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
  fit?: "fill" | "contain" | "cover";
  crop?: { top: number; right: number; bottom: number; left: number };
  radius?: PdfRadius;
  border?: PdfBorder;
  opacity?: number;
};

export type PdfElement =
  | PdfRectElement
  | PdfRoundRectElement
  | PdfEllipseElement
  | PdfLineElement
  | PdfTextElement
  | PdfImageElement;

export type PdfPage = {
  width?: number;
  height?: number;
  background?: PdfPaint;
  elements: readonly PdfElement[];
};

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 540;
const KAPPA = 0.5522847498;

const FONT_RESOURCES: Record<PdfFontName, string> = {
  Helvetica: "F1",
  "Helvetica-Bold": "F2",
  "Helvetica-Oblique": "F3",
  "Helvetica-BoldOblique": "F4",
};

const WIN_ANSI_MAP: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

export function parsePdfColor(color: PdfColor): [number, number, number] {
  if (typeof color === "string") {
    const clean = color.replace(/^#/, "");
    if (!/^[0-9A-Fa-f]{6}$/.test(clean))
      throw new PdfError(`invalid hex color "${color}"`);
    return [
      Number.parseInt(clean.slice(0, 2), 16) / 255,
      Number.parseInt(clean.slice(2, 4), 16) / 255,
      Number.parseInt(clean.slice(4, 6), 16) / 255,
    ];
  }
  const [r, g, b] = color;
  const scale = r > 1 || g > 1 || b > 1 ? 255 : 1;
  return [
    Math.max(0, Math.min(1, r / scale)),
    Math.max(0, Math.min(1, g / scale)),
    Math.max(0, Math.min(1, b / scale)),
  ];
}

function isGradient(paint: PdfPaint): paint is Exclude<PdfPaint, PdfColor> {
  return typeof paint === "object" && "stops" in paint;
}

function primaryColorOf(paint: PdfPaint): [number, number, number] {
  if (!isGradient(paint)) return parsePdfColor(paint);
  const first = paint.stops[0];
  if (!first) return [0, 0, 0];
  return parsePdfColor(first.color);
}

function resolveFontName(
  font?: PdfFontName,
  bold?: boolean,
  italic?: boolean,
): PdfFontName {
  if (font) return font;
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function encodePdfText(text: string): string {
  let out = "(";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const mapped = WIN_ANSI_MAP[code] ?? (code <= 0xff ? code : 0x3f);
    if (mapped === 0x28) out += "\\(";
    else if (mapped === 0x29) out += "\\)";
    else if (mapped === 0x5c) out += "\\\\";
    else if (mapped === 0x0a) out += "\\n";
    else if (mapped === 0x0d) out += "\\r";
    else if (mapped < 0x20 || mapped > 0x7e)
      out += `\\${mapped.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(mapped);
  }
  return `${out})`;
}

function charWidthRatio(ch: string, bold: boolean): number {
  const boost = bold ? 1.06 : 1;
  if (" il.,:;!|'\"`()[]{}".includes(ch)) return 0.28 * boost;
  if ("mwMW@%".includes(ch)) return 0.82 * boost;
  if (ch >= "A" && ch <= "Z") return 0.66 * boost;
  return 0.54 * boost;
}

export function measureTextWidth(
  text: string,
  size: number,
  bold = false,
  letterSpacing = 0,
): number {
  let width = 0;
  for (const ch of text)
    width += charWidthRatio(ch, bold) * size + letterSpacing;
  return width;
}

type StyledSegment = {
  text: string;
  font: PdfFontName;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number;
  color: [number, number, number];
  letterSpacing: number;
};

type WrappedLine = {
  segments: StyledSegment[];
  width: number;
  maxSize: number;
  indent: number;
  bullet?: { text: string; color: [number, number, number]; size: number };
};

function normalizeRun(
  raw: string | PdfTextRun,
  defaults: {
    font?: PdfFontName;
    bold?: boolean;
    italic?: boolean;
    size: number;
    color: [number, number, number];
  },
): StyledSegment {
  if (typeof raw === "string") {
    const bold = defaults.bold ?? false;
    const italic = defaults.italic ?? false;
    return {
      text: raw,
      font: resolveFontName(defaults.font, bold, italic),
      bold,
      italic,
      underline: false,
      strike: false,
      size: defaults.size,
      color: defaults.color,
      letterSpacing: 0,
    };
  }
  const bold = raw.bold ?? defaults.bold ?? false;
  const italic = raw.italic ?? defaults.italic ?? false;
  return {
    text: raw.text,
    font: resolveFontName(raw.font ?? defaults.font, bold, italic),
    bold,
    italic,
    underline: raw.underline ?? false,
    strike: raw.strike ?? false,
    size: raw.size ?? defaults.size,
    color: raw.color ? primaryColorOf(raw.color) : defaults.color,
    letterSpacing: raw.letterSpacing === undefined ? 0 : raw.letterSpacing,
  };
}

function splitSegmentsByNewline(
  segments: readonly StyledSegment[],
): StyledSegment[][] {
  const lines: StyledSegment[][] = [[]];
  for (const seg of segments) {
    const parts = seg.text.split(/\r?\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      const part = parts[i]!;
      if (part.length > 0) lines.at(-1)!.push({ ...seg, text: part });
    }
  }
  return lines;
}

function sameStyle(a: StyledSegment, b: StyledSegment): boolean {
  return (
    a.font === b.font &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.size === b.size &&
    a.letterSpacing === b.letterSpacing &&
    a.color[0] === b.color[0] &&
    a.color[1] === b.color[1] &&
    a.color[2] === b.color[2]
  );
}

function appendToken(list: StyledSegment[], token: StyledSegment) {
  const prev = list.at(-1);
  if (prev && sameStyle(prev, token)) prev.text += token.text;
  else list.push({ ...token });
}

function wrapLogicalLine(
  segments: readonly StyledSegment[],
  maxWidth: number,
  wrap: boolean,
  defaultSize: number,
): { segments: StyledSegment[]; width: number; maxSize: number }[] {
  if (segments.length === 0)
    return [{ segments: [], width: 0, maxSize: defaultSize }];
  if (!wrap || maxWidth <= 0) {
    const merged: StyledSegment[] = [];
    let width = 0;
    let maxSize = defaultSize;
    for (const s of segments) {
      appendToken(merged, s);
      width += measureTextWidth(s.text, s.size, s.bold, s.letterSpacing);
      if (s.size > maxSize) maxSize = s.size;
    }
    return [{ segments: merged, width, maxSize }];
  }

  const tokens: StyledSegment[] = [];
  for (const seg of segments) {
    const parts = seg.text.match(/\S+\s*|\s+/g) ?? [seg.text];
    for (const part of parts) tokens.push({ ...seg, text: part });
  }

  const wrapped: {
    segments: StyledSegment[];
    width: number;
    maxSize: number;
  }[] = [];
  let current: StyledSegment[] = [];
  let currentWidth = 0;
  let currentMaxSize = defaultSize;

  for (const token of tokens) {
    const tokenWidth = measureTextWidth(
      token.text,
      token.size,
      token.bold,
      token.letterSpacing,
    );
    if (current.length > 0 && currentWidth + tokenWidth > maxWidth) {
      wrapped.push({
        segments: current,
        width: currentWidth,
        maxSize: currentMaxSize,
      });
      const trimmed = token.text.replace(/^\s+/, "");
      if (trimmed.length === 0) {
        current = [];
        currentWidth = 0;
        currentMaxSize = defaultSize;
        continue;
      }
      const trimmedSeg = { ...token, text: trimmed };
      current = [trimmedSeg];
      currentWidth = measureTextWidth(
        trimmed,
        token.size,
        token.bold,
        token.letterSpacing,
      );
      currentMaxSize = token.size;
    } else {
      appendToken(current, token);
      currentWidth += tokenWidth;
      if (token.size > currentMaxSize) currentMaxSize = token.size;
    }
  }
  if (current.length > 0 || wrapped.length === 0)
    wrapped.push({
      segments: current,
      width: currentWidth,
      maxSize: currentMaxSize,
    });
  return wrapped;
}

class PageBuilder {
  readonly commands: string[] = [];
  readonly alphas = new Map<number, string>();
  readonly shadings = new Map<string, string>();
  readonly images = new Set<string>();

  constructor(
    readonly pageWidth: number,
    readonly pageHeight: number,
    readonly registerImage: (bytes: Uint8Array) => {
      name: string;
      info: PdfDecodedImage;
    },
  ) {}

  alphaName(opacity: number): string | undefined {
    const clamped = Math.max(0, Math.min(1, opacity));
    if (clamped >= 0.999) return undefined;
    const key = Math.round(clamped * 1000);
    const existing = this.alphas.get(key);
    if (existing) return existing;
    const name = `GS${this.alphas.size + 1}`;
    this.alphas.set(key, name);
    return name;
  }

  addLinearShading(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    c0: [number, number, number],
    c1: [number, number, number],
  ): string {
    const name = `Sh${this.shadings.size + 1}`;
    this.shadings.set(
      name,
      `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${fmt(c0[0])} ${fmt(c0[1])} ${fmt(c0[2])}] /C1 [${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c1[2])}] /N 1 >> /Extend [true true] >>`,
    );
    return name;
  }

  addRadialShading(
    cx: number,
    cy: number,
    r: number,
    c0: [number, number, number],
    c1: [number, number, number],
  ): string {
    const name = `Sh${this.shadings.size + 1}`;
    this.shadings.set(
      name,
      `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${fmt(cx)} ${fmt(cy)} 0 ${fmt(cx)} ${fmt(cy)} ${fmt(r)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${fmt(c0[0])} ${fmt(c0[1])} ${fmt(c0[2])}] /C1 [${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c1[2])}] /N 1 >> /Extend [true true] >>`,
    );
    return name;
  }
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`;
}

function roundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: PdfRadius,
): string {
  const [rawTl, rawTr, rawBr, rawBl] =
    typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  const maxR = Math.min(w, h) / 2;
  const tl = Math.max(0, Math.min(maxR, rawTl));
  const tr = Math.max(0, Math.min(maxR, rawTr));
  const br = Math.max(0, Math.min(maxR, rawBr));
  const bl = Math.max(0, Math.min(maxR, rawBl));
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return rectPath(x, y, w, h);

  // In PDF coordinates, y is bottom and y + h is top.
  const right = x + w;
  const top = y + h;
  return [
    `${fmt(x + bl)} ${fmt(y)} m`,
    `${fmt(right - br)} ${fmt(y)} l`,
    br > 0
      ? `${fmt(right - br * (1 - KAPPA))} ${fmt(y)} ${fmt(right)} ${fmt(y + br * (1 - KAPPA))} ${fmt(right)} ${fmt(y + br)} c`
      : "",
    `${fmt(right)} ${fmt(top - tr)} l`,
    tr > 0
      ? `${fmt(right)} ${fmt(top - tr * (1 - KAPPA))} ${fmt(right - tr * (1 - KAPPA))} ${fmt(top)} ${fmt(right - tr)} ${fmt(top)} c`
      : "",
    `${fmt(x + tl)} ${fmt(top)} l`,
    tl > 0
      ? `${fmt(x + tl * (1 - KAPPA))} ${fmt(top)} ${fmt(x)} ${fmt(top - tl * (1 - KAPPA))} ${fmt(x)} ${fmt(top - tl)} c`
      : "",
    `${fmt(x)} ${fmt(y + bl)} l`,
    bl > 0
      ? `${fmt(x)} ${fmt(y + bl * (1 - KAPPA))} ${fmt(x + bl * (1 - KAPPA))} ${fmt(y)} ${fmt(x + bl)} ${fmt(y)} c`
      : "",
    "h",
  ]
    .filter(Boolean)
    .join(" ");
}

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `${fmt(cx + rx)} ${fmt(cy)} m`,
    `${fmt(cx + rx)} ${fmt(cy + oy)} ${fmt(cx + ox)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`,
    `${fmt(cx - ox)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + oy)} ${fmt(cx - rx)} ${fmt(cy)} c`,
    `${fmt(cx - rx)} ${fmt(cy - oy)} ${fmt(cx - ox)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`,
    `${fmt(cx + ox)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - oy)} ${fmt(cx + rx)} ${fmt(cy)} c`,
    "h",
  ].join(" ");
}

function dashOperator(dash: PdfBorder["dash"], width: number): string {
  if (dash === "dash") return `[${fmt(width * 3)} ${fmt(width * 2)}] 0 d`;
  if (dash === "dot") return `[${fmt(width)} ${fmt(width * 2)}] 0 d`;
  return "[] 0 d";
}

function fillAndStrokePath(
  builder: PageBuilder,
  pathCmd: string,
  box: { x: number; y: number; w: number; h: number },
  fill: PdfPaint | undefined,
  border: PdfBorder | undefined,
  opacity = 1,
) {
  builder.commands.push("q");
  const gs = builder.alphaName(opacity);
  if (gs) builder.commands.push(`/${gs} gs`);

  if (fill !== undefined) {
    if (!isGradient(fill)) {
      const [r, g, b] = parsePdfColor(fill);
      builder.commands.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg ${pathCmd} f`);
    } else {
      const first = fill.stops[0];
      const last = fill.stops.at(-1);
      const c0 = first
        ? parsePdfColor(first.color)
        : ([0, 0, 0] as [number, number, number]);
      const c1 = last ? parsePdfColor(last.color) : c0;
      const shName =
        fill.type === "radial"
          ? builder.addRadialShading(
              box.x + box.w / 2,
              box.y + box.h / 2,
              Math.max(box.w, box.h) / 2,
              c0,
              c1,
            )
          : builder.addLinearShading(
              box.x,
              box.y + box.h,
              box.x + box.w,
              box.y,
              c0,
              c1,
            );
      builder.commands.push(
        `q ${pathCmd} W n ${fmt(c0[0])} ${fmt(c0[1])} ${fmt(c0[2])} rg /${shName} sh Q`,
      );
    }
  }

  if (border !== undefined && border.width > 0) {
    const [r, g, b] = parsePdfColor(border.color);
    const borderGs = builder.alphaName(opacity * (border.opacity ?? 1));
    if (borderGs) builder.commands.push(`/${borderGs} gs`);
    builder.commands.push(
      `${fmt(border.width)} w ${dashOperator(border.dash, border.width)} ${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${pathCmd} S`,
    );
  }
  builder.commands.push("Q");
}

function drawLineElement(builder: PageBuilder, el: PdfLineElement) {
  const width = el.width ?? 1;
  const [r, g, b] = parsePdfColor(el.color ?? "#000000");
  const y1 = builder.pageHeight - el.y1;
  const y2 = builder.pageHeight - el.y2;
  builder.commands.push("q");
  const gs = builder.alphaName(el.opacity ?? 1);
  if (gs) builder.commands.push(`/${gs} gs`);
  builder.commands.push(
    `${fmt(width)} w ${dashOperator(el.dash, width)} ${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(el.x1)} ${fmt(y1)} m ${fmt(el.x2)} ${fmt(y2)} l S`,
  );
  builder.commands.push("Q");
}

function drawImageElement(builder: PageBuilder, el: PdfImageElement) {
  const { name, info } = builder.registerImage(el.data);
  builder.images.add(name);
  const pdfY = builder.pageHeight - el.y - el.h;
  const box = { x: el.x, y: pdfY, w: el.w, h: el.h };

  let drawBox = box;
  if (el.fit === "contain") {
    const scale = Math.min(el.w / info.width, el.h / info.height);
    const w = info.width * scale;
    const h = info.height * scale;
    drawBox = {
      x: box.x + (box.w - w) / 2,
      y: box.y + (box.h - h) / 2,
      w,
      h,
    };
  } else if (el.fit === "cover") {
    const scale = Math.max(el.w / info.width, el.h / info.height);
    const w = info.width * scale;
    const h = info.height * scale;
    drawBox = {
      x: box.x + (box.w - w) / 2,
      y: box.y + (box.h - h) / 2,
      w,
      h,
    };
  }

  const clipPath = el.radius
    ? roundRectPath(box.x, box.y, box.w, box.h, el.radius)
    : rectPath(box.x, box.y, box.w, box.h);

  builder.commands.push("q");
  const gs = builder.alphaName(el.opacity ?? 1);
  if (gs) builder.commands.push(`/${gs} gs`);
  if (el.fit === "cover" || el.radius !== undefined)
    builder.commands.push(`${clipPath} W n`);
  builder.commands.push(
    `q ${fmt(drawBox.w)} 0 0 ${fmt(drawBox.h)} ${fmt(drawBox.x)} ${fmt(drawBox.y)} cm /${name} Do Q`,
  );
  builder.commands.push("Q");

  if (el.border)
    fillAndStrokePath(
      builder,
      clipPath,
      box,
      undefined,
      el.border,
      el.opacity ?? 1,
    );
}

function paragraphsOfTextElement(el: PdfTextElement): PdfParagraph[] {
  if (el.paragraphs && el.paragraphs.length > 0) return [...el.paragraphs];
  if (el.runs && el.runs.length > 0) {
    return [
      {
        runs: el.runs,
        ...(el.align ? { align: el.align } : {}),
      },
    ];
  }
  if (el.text !== undefined) {
    return [
      {
        runs: [el.text],
        ...(el.align ? { align: el.align } : {}),
      },
    ];
  }
  return [];
}

function drawTextElement(builder: PageBuilder, el: PdfTextElement) {
  const pdfY = builder.pageHeight - el.y - el.h;
  const box = { x: el.x, y: pdfY, w: el.w, h: el.h };
  if (el.fill !== undefined || el.border !== undefined) {
    fillAndStrokePath(
      builder,
      rectPath(box.x, box.y, box.w, box.h),
      box,
      el.fill,
      el.border,
      el.opacity ?? 1,
    );
  }

  const insets = el.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const innerX = el.x + insets.left;
  const innerY = el.y + insets.top;
  const innerW = Math.max(0, el.w - insets.left - insets.right);
  const innerH = Math.max(0, el.h - insets.top - insets.bottom);
  const defaultSize = el.size ?? 18;
  const defaultColor = el.color
    ? primaryColorOf(el.color)
    : ([0, 0, 0] as [number, number, number]);
  const wrap = el.wrap ?? true;

  type LayoutBlock = {
    align: "left" | "center" | "right" | "justify";
    lineHeight: number;
    spaceBefore: number;
    spaceAfter: number;
    lines: WrappedLine[];
  };

  const blocks: LayoutBlock[] = [];
  for (const para of paragraphsOfTextElement(el)) {
    const indent = para.indent === undefined ? 0 : para.indent;
    const segments = para.runs.map((r) =>
      normalizeRun(r, {
        ...(el.font ? { font: el.font } : {}),
        ...(el.bold !== undefined ? { bold: el.bold } : {}),
        ...(el.italic !== undefined ? { italic: el.italic } : {}),
        size: defaultSize,
        color: defaultColor,
      }),
    );
    const logical = splitSegmentsByNewline(segments);
    const paraLines: WrappedLine[] = [];
    for (const [lineIdx, lineSegs] of logical.entries()) {
      const wrapped = wrapLogicalLine(
        lineSegs,
        Math.max(1, innerW - indent),
        wrap,
        defaultSize,
      );
      for (const [wrapIdx, wLine] of wrapped.entries()) {
        const isFirst = lineIdx === 0 && wrapIdx === 0;
        paraLines.push({
          segments: wLine.segments,
          width: wLine.width,
          maxSize: wLine.maxSize,
          indent,
          ...(isFirst && para.bullet
            ? {
                bullet: {
                  text: para.bullet,
                  color: para.bulletColor
                    ? parsePdfColor(para.bulletColor)
                    : defaultColor,
                  size: wLine.maxSize,
                },
              }
            : {}),
        });
      }
    }
    const maxParaSize = Math.max(
      defaultSize,
      ...paraLines.map((l) => l.maxSize),
    );
    blocks.push({
      align: para.align ?? el.align ?? "left",
      lineHeight: para.lineHeight ?? maxParaSize * 1.25,
      spaceBefore: para.spaceBefore === undefined ? 0 : para.spaceBefore,
      spaceAfter: para.spaceAfter === undefined ? 0 : para.spaceAfter,
      lines: paraLines,
    });
  }

  let totalHeight = 0;
  for (const b of blocks)
    totalHeight += b.spaceBefore + b.lines.length * b.lineHeight + b.spaceAfter;

  let cursorTop = innerY;
  if (el.anchor === "middle")
    cursorTop = innerY + Math.max(0, (innerH - totalHeight) / 2);
  else if (el.anchor === "bottom")
    cursorTop = innerY + Math.max(0, innerH - totalHeight);

  builder.commands.push("q");
  const gs = builder.alphaName(el.opacity ?? 1);
  if (gs) builder.commands.push(`/${gs} gs`);

  for (const b of blocks) {
    cursorTop += b.spaceBefore;
    for (const line of b.lines) {
      const baselineY = builder.pageHeight - (cursorTop + line.maxSize * 0.82);
      let startX = innerX + line.indent;
      if (b.align === "center")
        startX =
          innerX +
          line.indent +
          Math.max(0, (innerW - line.indent - line.width) / 2);
      else if (b.align === "right")
        startX = innerX + Math.max(line.indent, innerW - line.width);

      if (line.bullet) {
        const [br, bg, bb] = line.bullet.color;
        const bulletX = Math.max(innerX, startX - line.bullet.size * 0.9);
        builder.commands.push(
          `BT /F1 ${fmt(line.bullet.size)} Tf ${fmt(br)} ${fmt(bg)} ${fmt(bb)} rg 1 0 0 1 ${fmt(bulletX)} ${fmt(baselineY)} Tm ${encodePdfText(line.bullet.text)} Tj ET`,
        );
      }

      let x = startX;
      for (const seg of line.segments) {
        if (seg.text.length === 0) continue;
        const fontRes = FONT_RESOURCES[seg.font];
        const [cr, cg, cb] = seg.color;
        const tc =
          seg.letterSpacing !== 0 ? ` ${fmt(seg.letterSpacing)} Tc` : "";
        const resetTc = seg.letterSpacing !== 0 ? " 0 Tc" : "";
        builder.commands.push(
          `BT /${fontRes} ${fmt(seg.size)} Tf ${fmt(cr)} ${fmt(cg)} ${fmt(cb)} rg${tc} 1 0 0 1 ${fmt(x)} ${fmt(baselineY)} Tm ${encodePdfText(seg.text)} Tj${resetTc} ET`,
        );
        const segW = measureTextWidth(
          seg.text,
          seg.size,
          seg.bold,
          seg.letterSpacing,
        );
        if (seg.underline) {
          const uy = baselineY - seg.size * 0.1;
          builder.commands.push(
            `${fmt(Math.max(0.75, seg.size * 0.05))} w [] 0 d ${fmt(cr)} ${fmt(cg)} ${fmt(cb)} RG ${fmt(x)} ${fmt(uy)} m ${fmt(x + segW)} ${fmt(uy)} l S`,
          );
        }
        if (seg.strike) {
          const sy = baselineY + seg.size * 0.28;
          builder.commands.push(
            `${fmt(Math.max(0.75, seg.size * 0.05))} w [] 0 d ${fmt(cr)} ${fmt(cg)} ${fmt(cb)} RG ${fmt(x)} ${fmt(sy)} m ${fmt(x + segW)} ${fmt(sy)} l S`,
          );
        }
        x += segW;
      }
      cursorTop += b.lineHeight;
    }
    cursorTop += b.spaceAfter;
  }

  builder.commands.push("Q");
}

function drawElement(builder: PageBuilder, el: PdfElement) {
  switch (el.type) {
    case "rect": {
      const pdfY = builder.pageHeight - el.y - el.h;
      const box = { x: el.x, y: pdfY, w: el.w, h: el.h };
      const path = el.radius
        ? roundRectPath(box.x, box.y, box.w, box.h, el.radius)
        : rectPath(box.x, box.y, box.w, box.h);
      fillAndStrokePath(
        builder,
        path,
        box,
        el.fill,
        el.border,
        el.opacity ?? 1,
      );
      break;
    }
    case "roundRect": {
      const pdfY = builder.pageHeight - el.y - el.h;
      const box = { x: el.x, y: pdfY, w: el.w, h: el.h };
      fillAndStrokePath(
        builder,
        roundRectPath(box.x, box.y, box.w, box.h, el.radius),
        box,
        el.fill,
        el.border,
        el.opacity ?? 1,
      );
      break;
    }
    case "ellipse": {
      const pdfY = builder.pageHeight - el.y - el.h;
      const box = { x: el.x, y: pdfY, w: el.w, h: el.h };
      fillAndStrokePath(
        builder,
        ellipsePath(box.x, box.y, box.w, box.h),
        box,
        el.fill,
        el.border,
        el.opacity ?? 1,
      );
      break;
    }
    case "line":
      drawLineElement(builder, el);
      break;
    case "image":
      drawImageElement(builder, el);
      break;
    case "text":
      drawTextElement(builder, el);
      break;
  }
}

const asciiEncoder = new TextEncoder();

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function byteHash(bytes: Uint8Array): string {
  return `${bytes.byteLength}:${adler32(bytes)}`;
}

/**
 * Writes pages as a deterministic PDF 1.4 document. Equal input always produces
 * identical bytes.
 */
export function writePdf(pages: readonly PdfPage[]): Uint8Array<ArrayBuffer> {
  if (pages.length === 0)
    throw new PdfError("PDF document must have at least one page");

  type ImageRecord = {
    name: string;
    info: PdfDecodedImage;
    objId: number;
    smaskObjId?: number;
  };

  let nextObjId = 7; // 1=Catalog, 2=Pages, 3..6=Fonts F1..F4
  const allocateObj = () => nextObjId++;

  const imageByHash = new Map<string, ImageRecord>();
  const registerImage = (bytes: Uint8Array) => {
    const key = byteHash(bytes);
    const existing = imageByHash.get(key);
    if (existing) return { name: existing.name, info: existing.info };
    const info = decodePdfImage(bytes);
    const name = `Im${imageByHash.size + 1}`;
    const smaskObjId = info.smask ? allocateObj() : undefined;
    const objId = allocateObj();
    const record: ImageRecord = {
      name,
      info,
      objId,
      ...(smaskObjId !== undefined ? { smaskObjId } : {}),
    };
    imageByHash.set(key, record);
    return { name, info };
  };

  const builtPages = pages.map((page) => {
    const width = page.width ?? DEFAULT_WIDTH;
    const height = page.height ?? DEFAULT_HEIGHT;
    const builder = new PageBuilder(width, height, registerImage);
    if (page.background !== undefined) {
      const box = { x: 0, y: 0, w: width, h: height };
      fillAndStrokePath(
        builder,
        rectPath(0, 0, width, height),
        box,
        page.background,
        undefined,
        1,
      );
    }
    for (const el of page.elements) drawElement(builder, el);
    const contentObjId = allocateObj();
    const pageObjId = allocateObj();
    return { width, height, builder, contentObjId, pageObjId };
  });

  const objects = new Map<number, Uint8Array>();
  const setAsciiObj = (id: number, body: string) => {
    objects.set(id, asciiEncoder.encode(`${id} 0 obj\n${body}\nendobj\n`));
  };
  const setStreamObj = (id: number, dict: string, stream: Uint8Array) => {
    objects.set(
      id,
      concatBytes([
        asciiEncoder.encode(
          `${id} 0 obj\n<< ${dict} /Length ${stream.byteLength} >>\nstream\n`,
        ),
        stream,
        asciiEncoder.encode("\nendstream\nendobj\n"),
      ]),
    );
  };

  setAsciiObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = builtPages.map((p) => `${p.pageObjId} 0 R`).join(" ");
  setAsciiObj(
    2,
    `<< /Type /Pages /Kids [${kids}] /Count ${builtPages.length} >>`,
  );

  const fontEntries = Object.entries(FONT_RESOURCES) as [PdfFontName, string][];
  fontEntries.forEach(([fontName], idx) => {
    setAsciiObj(
      3 + idx,
      `<< /Type /Font /Subtype /Type1 /BaseFont /${fontName} /Encoding /WinAnsiEncoding >>`,
    );
  });

  for (const record of imageByHash.values()) {
    const { info, objId, smaskObjId } = record;
    if (smaskObjId !== undefined && info.smask) {
      setStreamObj(
        smaskObjId,
        `/Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        info.smask,
      );
    }
    const smaskRef =
      smaskObjId !== undefined ? ` /SMask ${smaskObjId} 0 R` : "";
    setStreamObj(
      objId,
      `/Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.colorSpace} /BitsPerComponent 8 /Filter /${info.filter}${smaskRef}`,
      info.data,
    );
  }

  const imageByName = new Map<string, ImageRecord>();
  for (const rec of imageByHash.values()) imageByName.set(rec.name, rec);

  for (const p of builtPages) {
    const streamBytes = asciiEncoder.encode(p.builder.commands.join("\n"));
    setStreamObj(p.contentObjId, "", streamBytes);

    const fontDict = fontEntries
      .map(([, resName], idx) => `/${resName} ${3 + idx} 0 R`)
      .join(" ");
    const xobjects = [...p.builder.images]
      .map((name) => `/${name} ${imageByName.get(name)!.objId} 0 R`)
      .join(" ");
    const extGStates = [...p.builder.alphas.entries()]
      .map(
        ([key, name]) =>
          `/${name} << /Type /ExtGState /ca ${fmt(key / 1000)} /CA ${fmt(key / 1000)} >>`,
      )
      .join(" ");
    const shadings = [...p.builder.shadings.entries()]
      .map(([name, dict]) => `/${name} ${dict}`)
      .join(" ");

    const resourceParts = [
      `/Font << ${fontDict} >>`,
      xobjects ? `/XObject << ${xobjects} >>` : "",
      extGStates ? `/ExtGState << ${extGStates} >>` : "",
      shadings ? `/Shading << ${shadings} >>` : "",
    ]
      .filter(Boolean)
      .join(" ");

    setAsciiObj(
      p.pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(p.width)} ${fmt(p.height)}] /Resources << ${resourceParts} >> /Contents ${p.contentObjId} 0 R >>`,
    );
  }

  const totalObjects = nextObjId - 1;
  const chunks: Uint8Array[] = [asciiEncoder.encode("%PDF-1.4\n")];
  const offsets = new Uint32Array(totalObjects + 1);
  let byteOffset = chunks[0]!.byteLength;

  for (let id = 1; id <= totalObjects; id++) {
    const chunk = objects.get(id);
    if (!chunk) throw new PdfError(`missing PDF object ${id}`);
    offsets[id] = byteOffset;
    chunks.push(chunk);
    byteOffset += chunk.byteLength;
  }

  const xrefOffset = byteOffset;
  const xrefLines = [`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`];
  for (let id = 1; id <= totalObjects; id++)
    xrefLines.push(`${String(offsets[id]!).padStart(10, "0")} 00000 n \n`);
  xrefLines.push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  chunks.push(asciiEncoder.encode(xrefLines.join("")));
  return concatBytes(chunks);
}
