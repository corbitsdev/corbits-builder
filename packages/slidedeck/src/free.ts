import {
  freeElements,
  type AssetRef,
  type Border,
  type FreeElement,
  type FreeParagraph,
  type FreeRun,
  type GroupElement,
  type Link,
  type Paint,
  type PictureElement,
  type Radius,
  type Shadow,
  type ShapeElement,
  type TextElement,
} from "./deck.ts";
import { contain, coverCrop, type ImageInfo } from "./image.ts";
import type { Box } from "./layouts.ts";
import { colorFill, colorXml } from "./theme.ts";
import { escapeXml } from "./xml.ts";

/** What drawing needs from the slide part it draws into. */
export type DrawingPart = {
  nextId(): number;
  image(ref: AssetRef): { info: ImageInfo; relId: string };
  svg(ref: AssetRef): string;
  hyperlink(link: Link, ownColor?: boolean): string;
};

/** A shape an animation can target; `build` marks the shapes PowerPoint lists in the build list. */
export type Target = { spid: number; build: boolean };

const EMU_PER_PIXEL = 9525;
const emu = (pixels: number) => Math.round(pixels * EMU_PER_PIXEL);
// Font sizes and spacing are in hundredths of a point, and a CSS pixel is three quarters of a point.
const centipoints = (pixels: number) => Math.round(pixels * 75);
const DEGREE = 60000;
const angle = (degrees: number) =>
  Math.round((((degrees % 360) + 360) % 360) * DEGREE);
const percent = (fraction: number) => Math.round(fraction * 100000);

const boxOf = ({ x, y, w, h }: Box): Box => ({
  x: emu(x),
  y: emu(y),
  w: emu(w),
  h: emu(h),
});

const FLIPS = { horizontal: ' flipH="1"', vertical: ' flipV="1"' } as const;

function xfrm({ x, y, w, h }: Box, rotation = 0, flip?: keyof typeof FLIPS) {
  const rot = angle(rotation);
  return `<a:xfrm${rot === 0 ? "" : ` rot="${rot}"`}${flip ? FLIPS[flip] : ""}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
}

export function paintXml(paint: Paint, opacity = 1) {
  if (typeof paint === "string") return colorFill(paint, opacity);
  const stops = paint.stops
    .map(
      (stop) =>
        `<a:gs pos="${Math.round(stop.at * 1000)}">${colorXml(stop.color, (stop.opacity ?? 1) * opacity)}</a:gs>`,
    )
    .join("");
  // CSS measures from the top, clockwise; DrawingML from the left, so CSS 180 is DrawingML 90.
  const shade =
    paint.type === "linear"
      ? `<a:lin ang="${angle(paint.angle - 90)}" scaled="0"/>`
      : '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>';
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
}

const DASHES = { solid: "", dash: "dash", dot: "sysDot" } as const;

function lineXml(border: Border | undefined, opacity: number) {
  if (!border) return "<a:ln><a:noFill/></a:ln>";
  const dash = DASHES[border.dash];
  return `<a:ln w="${emu(border.width)}">${colorFill(border.color, (border.opacity ?? 1) * opacity)}${dash ? `<a:prstDash val="${dash}"/>` : ""}</a:ln>`;
}

function shadowXml(shadow: Shadow | undefined, box: Box, opacity: number) {
  if (!shadow) return "";
  const { x, y, blur, spread, color } = shadow;
  const direction = (Math.atan2(y, x) * 180) / Math.PI;
  const scale = (size: number) =>
    size > 0 ? percent((size + 2 * emu(spread)) / size) : 100000;
  return `<a:effectLst><a:outerShdw blurRad="${emu(blur)}" dist="${emu(Math.hypot(x, y))}" dir="${angle(direction)}" sx="${scale(box.w)}" sy="${scale(box.h)}" algn="ctr" rotWithShape="0">${colorXml(color, shadow.opacity * opacity)}</a:outerShdw></a:effectLst>`;
}

const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

/** DrawingML rounds every corner, two same-side corners or two diagonal ones; other mixes take the larger radius per side. */
function cornersXml(radius: Radius, { w, h }: Box) {
  const [tl, tr, br, bl] =
    typeof radius === "number" ? [radius, radius, radius, radius] : radius;
  const shortSide = Math.min(w, h);
  const adjust = (corner: number) =>
    shortSide === 0 ? 0 : percent(Math.min(emu(corner) / shortSide, 0.5));
  const preset = (name: string, ...corners: number[]) =>
    `<a:prstGeom prst="${name}"><a:avLst>${corners
      .map(
        (corner, index) =>
          `<a:gd name="adj${corners.length > 1 ? index + 1 : ""}" fmla="val ${adjust(corner)}"/>`,
      )
      .join("")}</a:avLst></a:prstGeom>`;
  if (tl === tr && tr === br && br === bl) return preset("roundRect", tl);
  if (tl === br && tr === bl) return preset("round2DiagRect", tl, tr);
  return preset("round2SameRect", Math.max(tl, tr), Math.max(br, bl));
}

function geometryXml(shape: ShapeElement, box: Box) {
  switch (shape.geometry) {
    case "roundRect":
      return cornersXml(shape.radius, box);
    case "rect":
      return RECT;
    default:
      return `<a:prstGeom prst="${shape.geometry}"><a:avLst/></a:prstGeom>`;
  }
}

const ALIGN = {
  left: "l",
  center: "ctr",
  right: "r",
  justify: "just",
} as const;
const ANCHOR = { top: "t", middle: "ctr", bottom: "b" } as const;

function runXml(run: FreeRun, part: DrawingPart, opacity: number) {
  const { text, font, size, weight, italic, underline, strike } = run;
  const attributes = [
    size === undefined ? "" : ` sz="${centipoints(size)}"`,
    weight === undefined ? "" : ` b="${weight >= 600 ? 1 : 0}"`,
    italic === undefined ? "" : ` i="${italic ? 1 : 0}"`,
    underline === undefined ? "" : ` u="${underline ? "sng" : "none"}"`,
    strike === undefined
      ? ""
      : ` strike="${strike ? "sngStrike" : "noStrike"}"`,
    run.letterSpacing === undefined
      ? ""
      : ` spc="${centipoints(run.letterSpacing)}"`,
  ].join("");
  // Text without its own colour follows the theme's, which carries no alpha of its own.
  const color = run.color ?? (opacity < 1 ? "text" : undefined);
  const typeface = font && escapeXml(font);
  const children = [
    color === undefined ? "" : paintXml(color, opacity),
    typeface
      ? `<a:latin typeface="${typeface}"/><a:cs typeface="${typeface}"/>`
      : "",
    run.link === undefined
      ? ""
      : part.hyperlink(run.link, run.color !== undefined),
  ].join("");
  const properties = children
    ? `<a:rPr lang="en-US"${attributes} dirty="0">${children}</a:rPr>`
    : `<a:rPr lang="en-US"${attributes} dirty="0"/>`;
  return text
    .split(/\r?\n/)
    .map((line) => `<a:r>${properties}<a:t>${escapeXml(line)}</a:t></a:r>`)
    .join(`<a:br>${properties}</a:br>`);
}

function paragraphXml(
  paragraph: FreeParagraph,
  part: DrawingPart,
  opacity: number,
) {
  const spacing = (tag: string, pixels: number) =>
    `<a:${tag}><a:spcPts val="${centipoints(pixels)}"/></a:${tag}>`;
  const properties = `<a:pPr marL="0" indent="0" algn="${ALIGN[paragraph.align]}">${paragraph.lineHeight === undefined ? "" : spacing("lnSpc", paragraph.lineHeight)}${spacing("spcBef", paragraph.spaceBefore)}${spacing("spcAft", paragraph.spaceAfter)}<a:buNone/></a:pPr>`;
  const runs = paragraph.runs.map((run) =>
    typeof run === "string" ? { text: run } : run,
  );
  if (runs.every((run) => run.text === ""))
    return `<a:p>${properties}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
  return `<a:p>${properties}${runs.map((run) => runXml(run, part, opacity)).join("")}</a:p>`;
}

type Drawn = { xml: string; spid: number; build: boolean };

function nonVisual(
  part: DrawingPart,
  element: { id?: string; link?: Link },
  kind: string,
) {
  const spid = part.nextId();
  const name = escapeXml(element.id ?? `${kind} ${spid}`);
  const link = element.link === undefined ? "" : part.hyperlink(element.link);
  return {
    spid,
    cNvPr: link
      ? `<p:cNvPr id="${spid}" name="${name}">${link}</p:cNvPr>`
      : `<p:cNvPr id="${spid}" name="${name}"/>`,
  };
}

function textXml(element: TextElement, part: DrawingPart, opacity: number) {
  const { spid, cNvPr } = nonVisual(part, element, "Text");
  const box = boxOf(element);
  const insets = element.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const body = `<a:bodyPr wrap="${element.wrap ? "square" : "none"}" lIns="${emu(insets.left)}" tIns="${emu(insets.top)}" rIns="${emu(insets.right)}" bIns="${emu(insets.bottom)}" anchor="${ANCHOR[element.anchor]}" rtlCol="0"><a:noAutofit/></a:bodyPr>`;
  const paragraphs = element.paragraphs
    .map((paragraph) => paragraphXml(paragraph, part, opacity))
    .join("");
  const fill = element.fill ? paintXml(element.fill, opacity) : "<a:noFill/>";
  return {
    spid,
    build: true,
    xml: `<p:sp><p:nvSpPr>${cNvPr}<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box, element.rotation)}${RECT}${fill}${lineXml(element.border, opacity)}${shadowXml(element.shadow, box, opacity)}</p:spPr><p:txBody>${body}<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`,
  };
}

function shapeXml(element: ShapeElement, part: DrawingPart, opacity: number) {
  const { spid, cNvPr } = nonVisual(part, element, "Shape");
  const box = boxOf(element);
  const fill =
    "fill" in element && element.fill
      ? paintXml(element.fill, opacity)
      : "<a:noFill/>";
  return {
    spid,
    build: true,
    xml: `<p:sp><p:nvSpPr>${cNvPr}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box, element.rotation, "flip" in element ? element.flip : undefined)}${geometryXml(element, box)}${fill}${lineXml(element.border, opacity)}${shadowXml(element.shadow, box, opacity)}</p:spPr></p:sp>`,
  };
}

const SVG_BLIP = (relId: string) =>
  `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${relId}"/></a:ext></a:extLst>`;

function sourceRectXml(element: PictureElement, info: ImageInfo, area: Box) {
  if (element.fit === "cover") return coverCrop(info, area);
  const { crop } = element;
  if (!crop) return "";
  return `<a:srcRect l="${percent(crop.left)}" t="${percent(crop.top)}" r="${percent(crop.right)}" b="${percent(crop.bottom)}"/>`;
}

function pictureXml(
  element: PictureElement,
  part: DrawingPart,
  opacity: number,
) {
  const { spid, cNvPr } = nonVisual(part, element, "Picture");
  const { info, relId } = part.image(element.image);
  const area = boxOf(element);
  const box = element.fit === "contain" ? contain(info, area) : area;
  const blipChildren = `${opacity < 1 ? `<a:alphaModFix amt="${percent(opacity)}"/>` : ""}${element.svg ? SVG_BLIP(part.svg(element.svg)) : ""}`;
  const blip = blipChildren
    ? `<a:blip r:embed="${relId}">${blipChildren}</a:blip>`
    : `<a:blip r:embed="${relId}"/>`;
  const geometry = element.radius ? cornersXml(element.radius, box) : RECT;
  const line = element.border ? lineXml(element.border, opacity) : "";
  return {
    spid,
    build: false,
    xml: `<p:pic><p:nvPicPr>${cNvPr}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}${sourceRectXml(element, info, area)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box, element.rotation)}${geometry}${line}${shadowXml(element.shadow, box, opacity)}</p:spPr></p:pic>`,
  };
}

/** The box around a group's descendants, so the group's child space is the slide's own. */
function groupBox(group: GroupElement): Box {
  const boxes = [...freeElements(group.children, [])]
    .map(([element]) => element)
    .filter((element) => element.type !== "group")
    .map(boxOf);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function groupXml(
  group: GroupElement,
  part: DrawingPart,
  targets: Map<string, Target>,
  opacity: number,
) {
  const { spid, cNvPr } = nonVisual(part, group, "Group");
  const { x, y, w, h } = groupBox(group);
  const children = group.children
    .map((child) => elementXml(child, part, targets, opacity))
    .join("");
  return {
    spid,
    build: false,
    xml: `<p:grpSp><p:nvGrpSpPr>${cNvPr}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="${x}" y="${y}"/><a:chExt cx="${w}" cy="${h}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`,
  };
}

function drawnXml(
  element: FreeElement,
  part: DrawingPart,
  targets: Map<string, Target>,
  opacity: number,
): Drawn {
  switch (element.type) {
    case "text":
      return textXml(element, part, opacity);
    case "shape":
      return shapeXml(element, part, opacity);
    case "image":
      return pictureXml(element, part, opacity);
    case "group":
      return groupXml(element, part, targets, opacity);
  }
}

/** Draws one element, recording the shape id of each element with an `id` for animations. */
export function elementXml(
  element: FreeElement,
  part: DrawingPart,
  targets: Map<string, Target>,
  inherited = 1,
): string {
  const opacity = inherited * (element.opacity ?? 1);
  const drawn = drawnXml(element, part, targets, opacity);
  if (element.id !== undefined)
    targets.set(element.id, { spid: drawn.spid, build: drawn.build });
  return drawn.xml;
}

export const backgroundXml = (paint: Paint) =>
  `<p:bg><p:bgPr>${paintXml(paint)}<a:effectLst/></p:bgPr></p:bg>`;
