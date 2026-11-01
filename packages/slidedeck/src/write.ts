import { zip, type ZipEntry } from "@corbits/zip";

import {
  assetKey,
  freeElements,
  slideRegions,
  validateDeck,
  type AssetRef,
  type Block,
  type Deck,
  type DeckInput,
  type DeckIssue,
  type Element,
  type Layout,
  type Link,
  type ListItem,
  type RichText,
  type Run,
  type Slide,
  type TextBlock,
} from "./deck.ts";
import { backgroundXml, elementXml, type Target } from "./free.ts";
import {
  contain,
  coverCrop,
  isSvg,
  readImage,
  type ImageInfo,
} from "./image.ts";
import {
  FREE_AREA,
  GROUP_HEADER,
  LAYOUT_ORDER,
  LIST_LEVELS,
  LOGO_BOX,
  SLIDE_SIZE,
  layoutPlaceholders,
  layoutXml,
  masterXml,
  numbering,
  placeholderTag,
  slideNumberField,
  xfrm,
  type Box,
  type Placeholder,
  type Role,
} from "./layouts.ts";
import { timingXml, transitionXml } from "./motion.ts";
import { COLOR_MAP, colorFill, themeXml } from "./theme.ts";
import {
  NAMESPACES,
  Relationships,
  XML_DECLARATION,
  escapeXml,
} from "./xml.ts";

/** Image bytes by `assetKey(ref)`; the writer never fetches an asset itself. */
export type Assets = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;

export class DeckError extends Error {
  override name = "DeckError";

  constructor(readonly issues: DeckIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
  }
}

/** SVG media has no info; its picture always carries a raster fallback. */
type Media = {
  name: string;
  data: Uint8Array<ArrayBuffer>;
  info: ImageInfo | undefined;
};
type AssetUse = { ref: AssetRef; path: string; slide?: number; svg?: true };

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument";
const PRESENTATION = `${CONTENT_TYPE}.presentationml`;
const STACK_GAP = 137160;

const lines = (text: string) => text.split(/\r?\n/);

// PowerPoint numbers adjacent numbered paragraphs at one level as one sequence; an unbulleted paragraph between two lists starts the second at 1.
const LIST_BREAK =
  '<a:p><a:pPr lvl="1"><a:spcBef><a:spcPts val="0"/></a:spcBef><a:buNone/></a:pPr><a:endParaRPr lang="en-US" sz="100" dirty="0"/></a:p>';

const flag = (
  name: string,
  value: boolean | undefined,
  on: string,
  off: string,
) => (value === undefined ? "" : ` ${name}="${value ? on : off}"`);

function runXml({ text, link, color, size, ...style }: Run, part: SlidePart) {
  const attributes = [
    size === undefined ? "" : ` sz="${Math.round(size * 100)}"`,
    flag("b", style.bold, "1", "0"),
    flag("i", style.italic, "1", "0"),
    flag("u", style.underline, "sng", "none"),
    flag("strike", style.strike, "sngStrike", "noStrike"),
  ].join("");
  const children = `${color ? colorFill(color) : ""}${link === undefined ? "" : part.hyperlink(link)}`;
  const properties = children
    ? `<a:rPr lang="en-US"${attributes} dirty="0">${children}</a:rPr>`
    : `<a:rPr lang="en-US"${attributes} dirty="0"/>`;
  return lines(text)
    .map((line) => `<a:r>${properties}<a:t>${escapeXml(line)}</a:t></a:r>`)
    .join(`<a:br>${properties}</a:br>`);
}

/** A plain string is a single run. */
function paragraph(text: RichText, part: SlidePart, properties = "") {
  const runs = (typeof text === "string" ? [text] : text).map((run) =>
    typeof run === "string" ? { text: run } : run,
  );
  if (runs.every((run) => run.text === ""))
    return `<a:p>${properties}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
  return `<a:p>${properties}${runs.map((run) => runXml(run, part)).join("")}</a:p>`;
}

const notesParagraph = (text: string) =>
  text === ""
    ? '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>'
    : `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;

/** List items become paragraphs at levels 1 and down, which the master styles as bullets or numbers. */
function* listParagraphs(
  items: readonly ListItem[],
  ordered: boolean,
  level: number,
): Generator<{ text: RichText; properties: string }> {
  for (const item of items) {
    const nested = typeof item === "object" && !Array.isArray(item);
    yield {
      text: nested ? item.text : item,
      properties: ordered
        ? `<a:pPr lvl="${level}"><a:buAutoNum type="${numbering(level)}"/></a:pPr>`
        : `<a:pPr lvl="${level}"/>`,
    };
    if (nested)
      yield* listParagraphs(item.items, item.ordered ?? ordered, level + 1);
  }
}

function textBlockXml(block: TextBlock, part: SlidePart) {
  if (block.type === "paragraph") return paragraph(block.text, part);
  return [...listParagraphs(block.items, block.ordered, 1)]
    .map(({ text, properties }) => paragraph(text, part, properties))
    .join("");
}

const isOrderedList = (block: TextBlock | undefined) =>
  block?.type === "list" && block.ordered;

function textBodyXml(blocks: readonly TextBlock[], part: SlidePart) {
  return blocks
    .map(
      (block, index) =>
        `${isOrderedList(block) && isOrderedList(blocks[index - 1]) ? LIST_BREAK : ""}${textBlockXml(block, part)}`,
    )
    .join("");
}

const isText = (block: Block): block is TextBlock =>
  block.type === "paragraph" || block.type === "list";

function assetUses(deck: Deck): AssetUse[] {
  const uses: AssetUse[] = deck.theme.logo
    ? [{ ref: deck.theme.logo, path: "theme.logo" }]
    : [];
  for (const [slide, content] of deck.slides.entries()) {
    if (content.layout === "image")
      uses.push({ ref: content.image, path: `slides[${slide}].image`, slide });
    for (const { path, blocks } of slideRegions(content))
      for (const [index, block] of blocks.entries())
        if (block.type === "image")
          uses.push({
            ref: block.image,
            path: `slides[${slide}].${path}[${index}].image`,
            slide,
          });
    if (content.layout !== "free") continue;
    for (const [element, path] of freeElements(content.elements, [])) {
      if (element.type !== "image") continue;
      const at = `slides[${slide}].elements${path.map((key) => (typeof key === "number" ? `[${key}]` : `.${key}`)).join("")}`;
      uses.push({ ref: element.image, path: `${at}.image`, slide });
      if (element.svg)
        uses.push({ ref: element.svg, path: `${at}.svg`, slide, svg: true });
    }
  }
  return uses;
}

const issueAt = ({ path, slide }: AssetUse, message: string): DeckIssue =>
  slide === undefined ? { path, message } : { slide, path, message };

const mediaKey = (ref: AssetRef, svg?: true) =>
  svg ? `svg:${assetKey(ref)}` : assetKey(ref);

/** Reads every image the deck names, reporting all missing or unreadable ones at once. */
function resolveMedia(deck: Deck, assets: Assets) {
  const byKey = new Map<string, Media>();
  const issues: DeckIssue[] = [];
  for (const use of assetUses(deck)) {
    const key = mediaKey(use.ref, use.svg);
    if (byKey.has(key)) continue;
    const data = assets.get(assetKey(use.ref));
    if (!data) {
      issues.push(
        issueAt(
          use,
          `${use.path} names asset "${assetKey(use.ref)}", which was not provided`,
        ),
      );
      continue;
    }
    if (use.svg) {
      if (isSvg(data))
        byKey.set(key, {
          name: `image${byKey.size + 1}.svg`,
          data,
          info: undefined,
        });
      else issues.push(issueAt(use, `${use.path} is not an SVG image`));
      continue;
    }
    const info = readImage(data);
    if (!info) {
      issues.push(
        issueAt(use, `${use.path} is not a PNG or JPEG image with a size`),
      );
      continue;
    }
    byKey.set(key, {
      name: `image${byKey.size + 1}.${info.format}`,
      data,
      info,
    });
  }
  if (issues.length > 0) throw new DeckError(issues);
  return {
    items: [...byKey.values()],
    get(ref: AssetRef, svg?: true) {
      const media = byKey.get(mediaKey(ref, svg));
      if (!media) throw new Error(`asset ${assetKey(ref)} was not resolved`);
      return media;
    },
    raster(ref: AssetRef) {
      const { name, info } = this.get(ref);
      if (!info)
        throw new Error(`asset ${assetKey(ref)} is not a raster image`);
      return { name, info };
    },
  };
}
type MediaStore = ReturnType<typeof resolveMedia>;

type Picture = {
  id: number;
  relId: string;
  box: Box;
  name?: string;
  nvPr?: string;
  crop?: string;
};

const picture = ({
  id,
  relId,
  box,
  name = `Picture ${id}`,
  nvPr = "",
  crop = "",
}: Picture) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr><a:picLocks noGrp="1" noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${nvPr}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

const textBox = (id: number, box: Box, paragraphs: string, listStyle: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle>${listStyle}</a:lstStyle>${paragraphs}</p:txBody></p:sp>`;

const placeholderShape = (
  id: number,
  placeholder: Placeholder,
  paragraphs: string,
  box?: Box,
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${placeholder.name} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${placeholderTag(placeholder)}</p:nvPr></p:nvSpPr><p:spPr>${box ? xfrm(box) : ""}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;

const LINK_OWN_COLOR =
  '<a:extLst><a:ext uri="{A12FA001-AC4F-418D-AE19-62706E023703}"><ahyp:hlinkClr xmlns:ahyp="http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor" val="tx"/></a:ext></a:extLst>';

class SlidePart {
  readonly rels = new Relationships();
  readonly shapes: string[] = [];
  #lastId = 1;

  constructor(readonly media: MediaStore) {}

  nextId() {
    return ++this.#lastId;
  }

  image(ref: AssetRef) {
    const media = this.media.raster(ref);
    return {
      info: media.info,
      relId: this.rels.add("image", `../media/${media.name}`),
    };
  }

  svg(ref: AssetRef) {
    return this.rels.add("image", `../media/${this.media.get(ref, true).name}`);
  }

  /** With `ownColor`, the linked text keeps its colour instead of the theme's link colour in PowerPoint 2019 and later. */
  hyperlink(link: Link, ownColor = false) {
    const color = ownColor ? LINK_OWN_COLOR : "";
    const close = color ? `>${color}</a:hlinkClick>` : "/>";
    if (typeof link === "string")
      return `<a:hlinkClick r:id="${this.rels.add("hyperlink", new URL(link).href, true)}"${close}`;
    const relId = this.rels.add("slide", `slide${link + 1}.xml`);
    return `<a:hlinkClick r:id="${relId}" action="ppaction://hlinksldjump"${close}`;
  }

  element(element: Element, box: Box) {
    const { info, relId } = this.image(element.image);
    this.shapes.push(
      element.fit === "contain"
        ? picture({ id: this.nextId(), relId, box: contain(info, box) })
        : picture({
            id: this.nextId(),
            relId,
            box,
            crop: coverCrop(info, box),
          }),
    );
  }
}

type Segment = { text: TextBlock[] } | { element: Element };

function segments(blocks: readonly Block[]) {
  const out: Segment[] = [];
  for (const block of blocks) {
    const last = out.at(-1);
    if (!isText(block)) out.push({ element: block });
    else if (last && "text" in last) last.text.push(block);
    else out.push({ text: [block] });
  }
  return out;
}

/** Stacks a region's blocks top to bottom in equal bands; the first text band fills the placeholder. */
function stack(
  part: SlidePart,
  blocks: readonly Block[],
  area: Box,
  placeholder?: Placeholder,
) {
  const bands = segments(blocks);
  const height = Math.round(
    (area.h - STACK_GAP * (bands.length - 1)) / bands.length,
  );
  let target = placeholder;
  for (const [index, band] of bands.entries()) {
    const box = {
      ...area,
      y: area.y + index * (height + STACK_GAP),
      h: height,
    };
    if ("element" in band) {
      part.element(band.element, box);
      continue;
    }
    const paragraphs = textBodyXml(band.text, part);
    if (!target) {
      part.shapes.push(textBox(part.nextId(), box, paragraphs, LIST_LEVELS));
      continue;
    }
    const fills = bands.length === 1 ? undefined : box;
    part.shapes.push(
      placeholderShape(part.nextId(), target, paragraphs, fills),
    );
    target = undefined;
  }
}

function textContent(
  slide: Exclude<Slide, { layout: "free" }>,
  part: SlidePart,
): Partial<Record<Role, string>> {
  switch (slide.layout) {
    case "title":
    case "section":
      return {
        title: paragraph(slide.title, part),
        ...(slide.subtitle && { subtitle: paragraph(slide.subtitle, part) }),
      };
    case "comparison":
      return {
        title: paragraph(slide.title, part),
        leftHeading: paragraph(slide.left.heading, part),
        rightHeading: paragraph(slide.right.heading, part),
      };
    case "image":
      return {
        ...(slide.title && { title: paragraph(slide.title, part) }),
        ...(slide.caption && { caption: paragraph(slide.caption, part) }),
      };
    case "blank":
      return {};
    default:
      return { title: paragraph(slide.title, part) };
  }
}

function imagePlaceholder(
  part: SlidePart,
  slide: Slide & { layout: "image" },
  placeholder: Placeholder,
) {
  const { info, relId } = part.image(slide.image);
  const id = part.nextId();
  const nvPr = placeholderTag(placeholder);
  if (slide.fit === "contain") {
    part.shapes.push(
      picture({ id, relId, box: contain(info, placeholder.box), nvPr }),
    );
    return;
  }
  // An untitled cover image is the whole slide, not a band inside the safe area.
  const box =
    slide.title === undefined ? { x: 0, y: 0, ...SLIDE_SIZE } : placeholder.box;
  part.shapes.push(
    picture({ id, relId, box, nvPr, crop: coverCrop(info, box) }),
  );
}

/** A free slide draws on the blank layout without the master's logo, footer or slide number. */
function freeSlide(slide: Slide & { layout: "free" }, part: SlidePart) {
  const targets = new Map<string, Target>();
  for (const element of slide.elements)
    part.shapes.push(elementXml(element, part, targets));
  return {
    background: slide.background ? backgroundXml(slide.background) : "",
    timing: slide.animations ? timingXml(slide.animations, targets) : "",
  };
}

/** A placed slide takes its background from the master and has no animations. */
function placedSlide(
  deck: Deck,
  slide: Exclude<Slide, { layout: "free" }>,
  index: number,
  part: SlidePart,
) {
  const content: Partial<Record<Role, string>> = {
    ...textContent(slide, part),
    ...(deck.footer?.text && { footer: paragraph(deck.footer.text, part) }),
    ...(deck.footer?.slideNumbers && {
      slideNumber: `<a:p>${slideNumberField(String(index + 1))}</a:p>`,
    }),
  };
  const byRole = new Map<Role, readonly Block[]>(
    slideRegions(slide).map((region) => [region.role, region.blocks]),
  );
  if (slide.layout === "blank") stack(part, slide.body, FREE_AREA);
  for (const placeholder of layoutPlaceholders(slide.layout)) {
    const blocks = byRole.get(placeholder.role);
    const text = content[placeholder.role];
    if (placeholder.role === "image" && slide.layout === "image")
      imagePlaceholder(part, slide, placeholder);
    else if (blocks) stack(part, blocks, placeholder.box, placeholder);
    else if (text !== undefined)
      part.shapes.push(placeholderShape(part.nextId(), placeholder, text));
  }
  return { background: "", timing: "" };
}

// Keynote drops an unused Picture with Caption layout and warns about removed media on open.
const deckLayouts = (deck: Deck) =>
  LAYOUT_ORDER.filter(
    (layout) =>
      layout !== "image" ||
      deck.slides.some((slide) => slide.layout === layout),
  );

function slideXml(
  deck: Deck,
  slide: Slide,
  index: number,
  media: MediaStore,
  layouts: readonly Layout[],
) {
  const part = new SlidePart(media);
  const layout = slide.layout === "free" ? "blank" : slide.layout;
  part.rels.add(
    "slideLayout",
    `../slideLayouts/slideLayout${layouts.indexOf(layout) + 1}.xml`,
  );
  const { background, timing } =
    slide.layout === "free"
      ? freeSlide(slide, part)
      : placedSlide(deck, slide, index, part);
  if (slide.notes !== undefined)
    part.rels.add("notesSlide", `../notesSlides/notesSlide${index + 1}.xml`);
  const transition = slide.transition ? transitionXml(slide.transition) : "";
  const masterShapes = slide.layout === "free" ? ' showMasterSp="0"' : "";
  return {
    notes: slide.notes,
    rels: part.rels,
    xml: `${XML_DECLARATION}<p:sld ${NAMESPACES}${masterShapes}><p:cSld>${background}<p:spTree>${GROUP_HEADER}${part.shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}${timing}</p:sld>`,
  };
}

function notesXml(notes: string) {
  const paragraphs = lines(notes).map(notesParagraph).join("");
  return `${XML_DECLARATION}<p:notes ${NAMESPACES}><p:cSld><p:spTree>${GROUP_HEADER}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const NOTES_MASTER = `${XML_DECLARATION}<p:notesMaster ${NAMESPACES}><p:cSld><p:spTree>${GROUP_HEADER}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm({ x: 685800, y: 1143000, w: 5486400, h: 3086100 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm({ x: 685800, y: 4400550, w: 5486400, h: 3600450 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${COLOR_MAP}</p:notesMaster>`;

function contentTypes(deck: Deck, layouts: readonly Layout[]) {
  const override = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="${type}"/>`;
  return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="svg" ContentType="image/svg+xml"/>${[
    override("ppt/presentation.xml", `${PRESENTATION}.presentation.main+xml`),
    override(
      "ppt/slideMasters/slideMaster1.xml",
      `${PRESENTATION}.slideMaster+xml`,
    ),
    ...layouts.map((_, index) =>
      override(
        `ppt/slideLayouts/slideLayout${index + 1}.xml`,
        `${PRESENTATION}.slideLayout+xml`,
      ),
    ),
    override(
      "ppt/notesMasters/notesMaster1.xml",
      `${PRESENTATION}.notesMaster+xml`,
    ),
    override("ppt/theme/theme1.xml", `${CONTENT_TYPE}.theme+xml`),
    override("ppt/theme/theme2.xml", `${CONTENT_TYPE}.theme+xml`),
    override("ppt/presProps.xml", `${PRESENTATION}.presProps+xml`),
    override("ppt/viewProps.xml", `${PRESENTATION}.viewProps+xml`),
    override("ppt/tableStyles.xml", `${PRESENTATION}.tableStyles+xml`),
    override(
      "docProps/core.xml",
      "application/vnd.openxmlformats-package.core-properties+xml",
    ),
    override("docProps/app.xml", `${CONTENT_TYPE}.extended-properties+xml`),
    ...deck.slides.flatMap((slide, index) => [
      override(`ppt/slides/slide${index + 1}.xml`, `${PRESENTATION}.slide+xml`),
      ...(slide.notes === undefined
        ? []
        : [
            override(
              `ppt/notesSlides/notesSlide${index + 1}.xml`,
              `${PRESENTATION}.notesSlide+xml`,
            ),
          ]),
    ]),
  ].join("")}</Types>`;
}

function titleXml(deck: Deck) {
  const title = deck.slides
    .map((slide) => ("title" in slide ? slide.title : undefined))
    .find(Boolean);
  return title ? `<dc:title>${escapeXml(title)}</dc:title>` : "";
}

function packageParts(deck: Deck, layouts: readonly Layout[]) {
  const root = new Relationships();
  root.add("officeDocument", "ppt/presentation.xml");
  root.add(
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    "docProps/core.xml",
  );
  root.add("extended-properties", "docProps/app.xml");

  const presentation = new Relationships();
  const masterId = presentation.add(
    "slideMaster",
    "slideMasters/slideMaster1.xml",
  );
  const notesMasterId = presentation.add(
    "notesMaster",
    "notesMasters/notesMaster1.xml",
  );
  presentation.add("presProps", "presProps.xml");
  presentation.add("viewProps", "viewProps.xml");
  presentation.add("theme", "theme/theme1.xml");
  presentation.add("tableStyles", "tableStyles.xml");
  const slideIds = deck.slides.map((_, index) =>
    presentation.add("slide", `slides/slide${index + 1}.xml`),
  );

  return [
    { path: "[Content_Types].xml", data: contentTypes(deck, layouts) },
    { path: "_rels/.rels", data: root.xml() },
    {
      path: "docProps/core.xml",
      data: `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${titleXml(deck)}</cp:coreProperties>`,
    },
    {
      path: "docProps/app.xml",
      data: `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Builder</Application><Slides>${deck.slides.length}</Slides><Notes>${deck.slides.filter((slide) => slide.notes !== undefined).length}</Notes></Properties>`,
    },
    {
      path: "ppt/presentation.xml",
      data: `${XML_DECLARATION}<p:presentation ${NAMESPACES}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterId}"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst><p:sldIdLst>${slideIds.map((id, index) => `<p:sldId id="${256 + index}" r:id="${id}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${SLIDE_SIZE.w}" cy="${SLIDE_SIZE.h}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    { path: "ppt/_rels/presentation.xml.rels", data: presentation.xml() },
    {
      path: "ppt/presProps.xml",
      data: `${XML_DECLARATION}<p:presentationPr ${NAMESPACES}/>`,
    },
    {
      path: "ppt/viewProps.xml",
      data: `${XML_DECLARATION}<p:viewPr ${NAMESPACES}/>`,
    },
    {
      path: "ppt/tableStyles.xml",
      data: `${XML_DECLARATION}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    },
    { path: "ppt/theme/theme1.xml", data: themeXml(deck.theme, "Builder") },
    {
      path: "ppt/theme/theme2.xml",
      data: themeXml(deck.theme, "Builder Notes"),
    },
  ];
}

function masterParts(
  deck: Deck,
  media: MediaStore,
  layouts: readonly Layout[],
) {
  const rels = new Relationships();
  for (const index of layouts.keys())
    rels.add("slideLayout", `../slideLayouts/slideLayout${index + 1}.xml`);
  rels.add("theme", "../theme/theme1.xml");
  const logo = deck.theme.logo && media.raster(deck.theme.logo);
  const logoXml = logo
    ? picture({
        id: 90,
        name: "Logo",
        relId: rels.add("image", `../media/${logo.name}`),
        box: contain(logo.info, LOGO_BOX),
      })
    : "";
  const layoutRels = new Relationships();
  layoutRels.add("slideMaster", "../slideMasters/slideMaster1.xml");
  const notesMasterRels = new Relationships();
  notesMasterRels.add("theme", "../theme/theme2.xml");
  return [
    {
      path: "ppt/slideMasters/slideMaster1.xml",
      data: masterXml(logoXml, layouts),
    },
    { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels.xml() },
    ...layouts.flatMap((layout, index) => [
      {
        path: `ppt/slideLayouts/slideLayout${index + 1}.xml`,
        data: layoutXml(layout),
      },
      {
        path: `ppt/slideLayouts/_rels/slideLayout${index + 1}.xml.rels`,
        data: layoutRels.xml(),
      },
    ]),
    { path: "ppt/notesMasters/notesMaster1.xml", data: NOTES_MASTER },
    {
      path: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      data: notesMasterRels.xml(),
    },
  ];
}

function slideParts(deck: Deck, media: MediaStore, layouts: readonly Layout[]) {
  return deck.slides.flatMap((slide, index) => {
    const number = index + 1;
    const { xml, rels, notes } = slideXml(deck, slide, index, media, layouts);
    if (notes === undefined)
      return [
        { path: `ppt/slides/slide${number}.xml`, data: xml },
        { path: `ppt/slides/_rels/slide${number}.xml.rels`, data: rels.xml() },
      ];
    const notesRels = new Relationships();
    notesRels.add("notesMaster", "../notesMasters/notesMaster1.xml");
    notesRels.add("slide", `../slides/slide${number}.xml`);
    return [
      { path: `ppt/slides/slide${number}.xml`, data: xml },
      { path: `ppt/slides/_rels/slide${number}.xml.rels`, data: rels.xml() },
      {
        path: `ppt/notesSlides/notesSlide${number}.xml`,
        data: notesXml(notes),
      },
      {
        path: `ppt/notesSlides/_rels/notesSlide${number}.xml.rels`,
        data: notesRels.xml(),
      },
    ];
  });
}

/**
 * Writes a deck as a .pptx. The same deck and assets give the same bytes under one deflate
 * implementation; Bun and browsers can compress differently.
 */
export async function writePptx(
  input: DeckInput,
  assets: Assets = new Map(),
): Promise<Uint8Array<ArrayBuffer>> {
  const checked = validateDeck(input);
  if (!checked.ok) throw new DeckError(checked.issues);
  const { deck } = checked;
  const media = resolveMedia(deck, assets);
  const layouts = deckLayouts(deck);
  const entries: ZipEntry[] = [
    ...packageParts(deck, layouts),
    ...masterParts(deck, media, layouts),
    ...slideParts(deck, media, layouts),
    ...media.items.map(({ name, data }) => ({
      path: `ppt/media/${name}`,
      data,
    })),
  ];
  return zip(entries);
}
