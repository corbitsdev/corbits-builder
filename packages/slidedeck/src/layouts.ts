import type { Layout } from "./deck.ts";
import { COLOR_MAP } from "./theme.ts";
import { NAMESPACES, XML_DECLARATION, escapeXml } from "./xml.ts";

export type Box = { x: number; y: number; w: number; h: number };

const EMU_PER_INCH = 914400;
const inch = (value: number) => Math.round(value * EMU_PER_INCH);
const inches = (x: number, y: number, w: number, h: number): Box => ({
  x: inch(x),
  y: inch(y),
  w: inch(w),
  h: inch(h),
});

const SLIDE_WIDTH = 40 / 3;
export const SLIDE_SIZE = { w: inch(SLIDE_WIDTH), h: inch(7.5) };

const MARGIN = 0.6;
const WIDTH = SLIDE_WIDTH - 2 * MARGIN;
const GAP = 0.4;
const COLUMN = (WIDTH - GAP) / 2;
const RIGHT_COLUMN = MARGIN + COLUMN + GAP;
const BODY_TOP = 1.45;
const BODY_HEIGHT = 4.95;
const LOGO_TOP = 0.35;
const LOGO_WIDTH = 1.2;
const LOGO_HEIGHT = 0.6;

export const LOGO_BOX = inches(
  SLIDE_WIDTH - MARGIN - LOGO_WIDTH,
  LOGO_TOP,
  LOGO_WIDTH,
  LOGO_HEIGHT,
);
const FREE_TOP = LOGO_TOP + LOGO_HEIGHT + 0.2;

/** Free content on a blank slide sits below the logo area and above the footer. */
export const FREE_AREA = inches(MARGIN, FREE_TOP, WIDTH, 6.4 - FREE_TOP);

type Kind =
  | "title"
  | "ctrTitle"
  | "subTitle"
  | "body"
  | "obj"
  | "pic"
  | "ftr"
  | "sldNum";

export type Role =
  | "title"
  | "subtitle"
  | "body"
  | "left"
  | "right"
  | "leftHeading"
  | "rightHeading"
  | "image"
  | "caption"
  | "footer"
  | "slideNumber";

type TextStyle = {
  anchor?: "t" | "ctr" | "b";
  align?: "l" | "ctr" | "r";
  size?: number;
  bold?: boolean;
  color?: string;
};

export type Placeholder = {
  role: Role;
  kind: Kind;
  idx: number;
  name: string;
  box: Box;
} & TextStyle;

const FOOTER: Placeholder = {
  role: "footer",
  kind: "ftr",
  idx: 11,
  name: "Footer",
  box: inches(MARGIN, 6.75, 8, 0.4),
  anchor: "ctr",
  size: 1200,
  color: "tx2",
};
const SLIDE_NUMBER: Placeholder = {
  role: "slideNumber",
  kind: "sldNum",
  idx: 12,
  name: "Slide Number",
  box: inches(SLIDE_WIDTH - MARGIN - 1.5, 6.75, 1.5, 0.4),
  anchor: "ctr",
  align: "r",
  size: 1200,
  color: "tx2",
};

const subtitleStyle = { size: 2000, color: "tx2" } as const;
const headingStyle = {
  anchor: "b",
  size: 2000,
  bold: true,
  color: "accent1",
} as const;

function placeholders() {
  // The title always stops short of the logo area, so adding a logo never moves a title.
  const titleWidth = WIDTH - LOGO_WIDTH - GAP;
  const title: Placeholder = {
    role: "title",
    kind: "title",
    idx: 0,
    name: "Title",
    box: inches(MARGIN, 0.35, titleWidth, 0.9),
    anchor: "ctr",
  };
  const body = (role: Role, idx: number, box: Box): Placeholder => ({
    role,
    kind: "obj",
    idx,
    name: "Content",
    box,
  });
  const text = (
    role: Role,
    idx: number,
    box: Box,
    style: TextStyle,
  ): Placeholder => ({
    role,
    kind: "body",
    idx,
    name: "Text",
    box,
    ...style,
  });
  const headingHeight = 0.6;
  const comparisonTop = BODY_TOP + headingHeight + 0.1;
  const comparisonHeight = BODY_HEIGHT - headingHeight - 0.1;
  return {
    title: [
      {
        role: "title",
        kind: "ctrTitle",
        idx: 0,
        name: "Title",
        box: inches(MARGIN, 2.2, WIDTH, 1.5),
        anchor: "b",
        align: "ctr",
        size: 4400,
        bold: true,
      },
      {
        role: "subtitle",
        kind: "subTitle",
        idx: 1,
        name: "Subtitle",
        box: inches(MARGIN, 3.85, WIDTH, 1.0),
        anchor: "t",
        align: "ctr",
        ...subtitleStyle,
      },
    ],
    section: [
      {
        ...title,
        box: inches(MARGIN, 2.4, WIDTH, 1.4),
        anchor: "b",
        size: 4000,
      },
      text("subtitle", 1, inches(MARGIN, 3.9, WIDTH, 0.9), {
        anchor: "t",
        ...subtitleStyle,
      }),
    ],
    content: [
      title,
      body("body", 1, inches(MARGIN, BODY_TOP, WIDTH, BODY_HEIGHT)),
    ],
    "two-column": [
      title,
      body("left", 1, inches(MARGIN, BODY_TOP, COLUMN, BODY_HEIGHT)),
      body("right", 2, inches(RIGHT_COLUMN, BODY_TOP, COLUMN, BODY_HEIGHT)),
    ],
    comparison: [
      title,
      text(
        "leftHeading",
        1,
        inches(MARGIN, BODY_TOP, COLUMN, headingHeight),
        headingStyle,
      ),
      body("left", 2, inches(MARGIN, comparisonTop, COLUMN, comparisonHeight)),
      text(
        "rightHeading",
        3,
        inches(RIGHT_COLUMN, BODY_TOP, COLUMN, headingHeight),
        headingStyle,
      ),
      body(
        "right",
        4,
        inches(RIGHT_COLUMN, comparisonTop, COLUMN, comparisonHeight),
      ),
    ],
    image: [
      title,
      {
        role: "image",
        kind: "pic",
        idx: 1,
        name: "Picture",
        box: inches(MARGIN, BODY_TOP, WIDTH, 4.25),
      },
      text("caption", 2, inches(MARGIN, BODY_TOP + 4.35, WIDTH, 0.6), {
        anchor: "t",
        align: "ctr",
        size: 1400,
        color: "tx2",
      }),
    ],
    blank: [],
  } satisfies Record<Layout, Placeholder[]>;
}

const LAYOUTS: Record<Layout, { type: string; name: string }> = {
  title: { type: "title", name: "Title Slide" },
  section: { type: "secHead", name: "Section Header" },
  content: { type: "obj", name: "Title and Content" },
  "two-column": { type: "twoObj", name: "Two Content" },
  comparison: { type: "twoTxTwoObj", name: "Comparison" },
  image: { type: "picTx", name: "Picture with Caption" },
  blank: { type: "blank", name: "Blank" },
};

export const LAYOUT_ORDER = Object.keys(LAYOUTS) as Layout[];

export function layoutPlaceholders(layout: Layout): Placeholder[] {
  return [...placeholders()[layout], FOOTER, SLIDE_NUMBER];
}

export const xfrm = ({ x, y, w, h }: Box) =>
  `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

export const GROUP_HEADER =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

export function placeholderTag({ kind, idx }: Placeholder) {
  switch (kind) {
    case "title":
    case "ctrTitle":
      return `<p:ph type="${kind}"/>`;
    case "obj":
      return `<p:ph idx="${idx}"/>`;
    case "ftr":
    case "sldNum":
      return `<p:ph type="${kind}" sz="quarter" idx="${idx}"/>`;
    default:
      return `<p:ph type="${kind}" idx="${idx}"/>`;
  }
}

export const slideNumberField = (text: string) =>
  `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>${text}</a:t></a:fld>`;

function styleXml({ size, bold, color, align }: Placeholder) {
  const run = [size && `sz="${size}"`, bold && 'b="1"']
    .filter(Boolean)
    .join(" ");
  const fill = color
    ? `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`
    : "";
  return `<a:lstStyle><a:lvl1pPr${align ? ` algn="${align}"` : ""}><a:defRPr${run ? ` ${run}` : ""}>${fill}</a:defRPr></a:lvl1pPr></a:lstStyle>`;
}

function templateShape(id: number, placeholder: Placeholder) {
  const prompt =
    placeholder.kind === "sldNum"
      ? slideNumberField("‹#›")
      : `<a:r><a:rPr lang="en-US"/><a:t>${escapeXml(placeholder.name)}</a:t></a:r>`;
  const anchor = placeholder.anchor ? ` anchor="${placeholder.anchor}"` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${placeholder.name} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${placeholderTag(placeholder)}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(placeholder.box)}</p:spPr><p:txBody><a:bodyPr${anchor}><a:normAutofit/></a:bodyPr>${styleXml(placeholder)}<a:p>${prompt}</a:p></p:txBody></p:sp>`;
}

export function layoutXml(layout: Layout) {
  const { type, name } = LAYOUTS[layout];
  const shapes = layoutPlaceholders(layout)
    .map((placeholder, index) => templateShape(index + 2, placeholder))
    .join("");
  return `${XML_DECLARATION}<p:sldLayout ${NAMESPACES} type="${type}" preserve="1"><p:cSld name="${name}"><p:spTree>${GROUP_HEADER}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

const LIST_INDENT = inch(0.35);
const BULLET_HANG = inch(0.25);
const LIST_LEVEL_STYLES = [
  { bullet: "•", numbering: "arabicPeriod", size: 2000 },
  { bullet: "–", numbering: "alphaLcPeriod", size: 1800 },
  { bullet: "•", numbering: "romanLcPeriod", size: 1600 },
  { bullet: "–", numbering: "arabicParenR", size: 1600 },
  { bullet: "•", numbering: "alphaLcParenR", size: 1600 },
];

/** The numbering scheme for a numbered list item; paragraph level 0 is plain text, so lists start at 1. */
export function numbering(level: number) {
  const style = LIST_LEVEL_STYLES[level - 1];
  if (!style) throw new Error(`lists have no level ${level}`);
  return style.numbering;
}

/** Paragraph levels 2–6 carry the list indents, bullets and sizes, in the master and in free text boxes. */
export const LIST_LEVELS = LIST_LEVEL_STYLES.map(
  ({ bullet, size }, index) =>
    `<a:lvl${index + 2}pPr marL="${LIST_INDENT * (index + 1)}" indent="${-BULLET_HANG}"><a:spcBef><a:spcPts val="400"/></a:spcBef><a:buClr><a:schemeClr val="accent1"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${bullet}"/><a:defRPr sz="${size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl${index + 2}pPr>`,
).join("");

export function masterXml(logo: string) {
  // Layouts' untyped content placeholders inherit from the master's body; PowerPoint rejects an untyped one on the master itself.
  const content = placeholders().content.map((placeholder) =>
    placeholder.kind === "obj"
      ? { ...placeholder, kind: "body" as const }
      : placeholder,
  );
  const shapes = [...content, FOOTER, SLIDE_NUMBER]
    .map((placeholder, index) => templateShape(index + 2, placeholder))
    .join("");
  const layoutIds = LAYOUT_ORDER.map(
    (_, index) =>
      `<p:sldLayoutId id="${2147483649 + index}" r:id="rId${index + 1}"/>`,
  ).join("");
  const level = (size: number, extra = "") =>
    `<a:lvl1pPr${extra}><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buNone/><a:defRPr sz="${size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>`;
  return `${XML_DECLARATION}<p:sldMaster ${NAMESPACES}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP_HEADER}${shapes}${logo}</p:spTree></p:cSld>${COLOR_MAP}<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst><p:hf hdr="0" dt="0"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${level(2000, ' marL="0" indent="0"')}${LIST_LEVELS}</p:bodyStyle><p:otherStyle>${level(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`;
}
