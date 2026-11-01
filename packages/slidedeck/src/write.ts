import { zip, type ZipEntry } from "@corbits/zip";

import {
  assetKey,
  validateDeck,
  type AssetRef,
  type Block,
  type Deck,
  type DeckInput,
  type DeckIssue,
  type Element,
  type Slide,
  type TextBlock,
} from "./deck.ts";
import { readImage, type ImageInfo } from "./image.ts";
import {
  FREE_AREA,
  GROUP_HEADER,
  LAYOUT_ORDER,
  LOGO_BOX,
  SLIDE_SIZE,
  layoutPlaceholders,
  layoutXml,
  masterXml,
  placeholderTag,
  slideNumberField,
  xfrm,
  type Box,
  type Placeholder,
  type Role,
} from "./layouts.ts";
import { COLOR_MAP, themeXml } from "./theme.ts";
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

type Media = { name: string; data: Uint8Array<ArrayBuffer>; info: ImageInfo };
type AssetUse = { ref: AssetRef; path: string; slide?: number };
type Region = { role: Role; path: string; blocks: readonly Block[] };

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument";
const PRESENTATION = `${CONTENT_TYPE}.presentationml`;
const STACK_GAP = 137160;

const lines = (text: string) => text.split(/\r?\n/);

const run = (text: string) =>
  `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r>`;

function paragraph(text: string) {
  if (text === "") return '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>';
  return `<a:p>${lines(text).map(run).join('<a:br><a:rPr lang="en-US"/></a:br>')}</a:p>`;
}

const isText = (block: Block): block is TextBlock => block.type === "paragraph";

function regions(slide: Slide): Region[] {
  switch (slide.layout) {
    case "content":
    case "blank":
      return [{ role: "body", path: "body", blocks: slide.body }];
    case "two-column":
      return [
        { role: "left", path: "left", blocks: slide.left },
        { role: "right", path: "right", blocks: slide.right },
      ];
    case "comparison":
      return [
        { role: "left", path: "left.body", blocks: slide.left.body },
        { role: "right", path: "right.body", blocks: slide.right.body },
      ];
    default:
      return [];
  }
}

function assetUses(deck: Deck): AssetUse[] {
  const uses: AssetUse[] = deck.theme.logo
    ? [{ ref: deck.theme.logo, path: "theme.logo" }]
    : [];
  for (const [slide, content] of deck.slides.entries()) {
    if (content.layout === "image")
      uses.push({ ref: content.image, path: `slides[${slide}].image`, slide });
    for (const { path, blocks } of regions(content))
      for (const [index, block] of blocks.entries())
        if (block.type === "image")
          uses.push({
            ref: block.image,
            path: `slides[${slide}].${path}[${index}].image`,
            slide,
          });
  }
  return uses;
}

const issueAt = ({ path, slide }: AssetUse, message: string): DeckIssue =>
  slide === undefined ? { path, message } : { slide, path, message };

/** Reads every image the deck names, reporting all missing or unreadable ones at once. */
function resolveMedia(deck: Deck, assets: Assets) {
  const byKey = new Map<string, Media>();
  const issues: DeckIssue[] = [];
  for (const use of assetUses(deck)) {
    const key = assetKey(use.ref);
    if (byKey.has(key)) continue;
    const data = assets.get(key);
    if (!data) {
      issues.push(
        issueAt(
          use,
          `${use.path} names asset "${key}", which was not provided`,
        ),
      );
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
    get(ref: AssetRef) {
      const media = byKey.get(assetKey(ref));
      if (!media) throw new Error(`asset ${assetKey(ref)} was not resolved`);
      return media;
    },
  };
}
type MediaStore = ReturnType<typeof resolveMedia>;

function contain({ width, height }: ImageInfo, box: Box): Box {
  const scale = Math.min(box.w / width, box.h / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return {
    x: box.x + Math.round((box.w - w) / 2),
    y: box.y + Math.round((box.h - h) / 2),
    w,
    h,
  };
}

// Cover fills the box and crops the overflow evenly; srcRect is in thousandths of a percent per side.
function coverCrop({ width, height }: ImageInfo, box: Box) {
  const visible = box.w / box.h / (width / height);
  const side = (fraction: number) => Math.round(((1 - fraction) / 2) * 100000);
  return visible < 1
    ? `<a:srcRect l="${side(visible)}" r="${side(visible)}"/>`
    : `<a:srcRect t="${side(1 / visible)}" b="${side(1 / visible)}"/>`;
}

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

const textBox = (id: number, box: Box, paragraphs: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;

const placeholderShape = (
  id: number,
  placeholder: Placeholder,
  paragraphs: string,
  box?: Box,
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${placeholder.name} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${placeholderTag(placeholder)}</p:nvPr></p:nvSpPr><p:spPr>${box ? xfrm(box) : ""}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;

class SlidePart {
  readonly rels = new Relationships();
  readonly shapes: string[] = [];
  #lastId = 1;

  constructor(readonly media: MediaStore) {}

  nextId() {
    return ++this.#lastId;
  }

  image(ref: AssetRef) {
    const media = this.media.get(ref);
    return {
      info: media.info,
      relId: this.rels.add("image", `../media/${media.name}`),
    };
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
    const paragraphs = band.text.map((block) => paragraph(block.text)).join("");
    if (!target) {
      part.shapes.push(textBox(part.nextId(), box, paragraphs));
      continue;
    }
    const fills = bands.length === 1 ? undefined : box;
    part.shapes.push(
      placeholderShape(part.nextId(), target, paragraphs, fills),
    );
    target = undefined;
  }
}

function textContent(slide: Slide): Partial<Record<Role, string>> {
  switch (slide.layout) {
    case "title":
    case "section":
      return {
        title: paragraph(slide.title),
        ...(slide.subtitle && { subtitle: paragraph(slide.subtitle) }),
      };
    case "comparison":
      return {
        title: paragraph(slide.title),
        leftHeading: paragraph(slide.left.heading),
        rightHeading: paragraph(slide.right.heading),
      };
    case "image":
      return {
        ...(slide.title && { title: paragraph(slide.title) }),
        ...(slide.caption && { caption: paragraph(slide.caption) }),
      };
    case "blank":
      return {};
    default:
      return { title: paragraph(slide.title) };
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

function slideXml(deck: Deck, slide: Slide, index: number, media: MediaStore) {
  const part = new SlidePart(media);
  part.rels.add(
    "slideLayout",
    `../slideLayouts/slideLayout${LAYOUT_ORDER.indexOf(slide.layout) + 1}.xml`,
  );
  const content: Partial<Record<Role, string>> = {
    ...textContent(slide),
    ...(deck.footer?.text && { footer: paragraph(deck.footer.text) }),
    ...(deck.footer?.slideNumbers && {
      slideNumber: `<a:p>${slideNumberField(String(index + 1))}</a:p>`,
    }),
  };
  const byRole = new Map(
    regions(slide).map((region) => [region.role, region.blocks]),
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
  if (slide.notes !== undefined)
    part.rels.add("notesSlide", `../notesSlides/notesSlide${index + 1}.xml`);
  return {
    notes: slide.notes,
    rels: part.rels,
    xml: `${XML_DECLARATION}<p:sld ${NAMESPACES}><p:cSld><p:spTree>${GROUP_HEADER}${part.shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  };
}

function notesXml(notes: string) {
  return `${XML_DECLARATION}<p:notes ${NAMESPACES}><p:cSld><p:spTree>${GROUP_HEADER}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${lines(notes).map(paragraph).join("")}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const NOTES_MASTER = `${XML_DECLARATION}<p:notesMaster ${NAMESPACES}><p:cSld><p:spTree>${GROUP_HEADER}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm({ x: 685800, y: 1143000, w: 5486400, h: 3086100 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm({ x: 685800, y: 4400550, w: 5486400, h: 3600450 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${COLOR_MAP}</p:notesMaster>`;

function contentTypes(deck: Deck) {
  const override = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="${type}"/>`;
  return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${[
    override("ppt/presentation.xml", `${PRESENTATION}.presentation.main+xml`),
    override(
      "ppt/slideMasters/slideMaster1.xml",
      `${PRESENTATION}.slideMaster+xml`,
    ),
    ...LAYOUT_ORDER.map((_, index) =>
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

function packageParts(deck: Deck) {
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
    { path: "[Content_Types].xml", data: contentTypes(deck) },
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

function masterParts(deck: Deck, media: MediaStore) {
  const rels = new Relationships();
  for (const index of LAYOUT_ORDER.keys())
    rels.add("slideLayout", `../slideLayouts/slideLayout${index + 1}.xml`);
  rels.add("theme", "../theme/theme1.xml");
  const logo = deck.theme.logo && media.get(deck.theme.logo);
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
    { path: "ppt/slideMasters/slideMaster1.xml", data: masterXml(logoXml) },
    { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels.xml() },
    ...LAYOUT_ORDER.flatMap((layout, index) => [
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

function slideParts(deck: Deck, media: MediaStore) {
  return deck.slides.flatMap((slide, index) => {
    const number = index + 1;
    const { xml, rels, notes } = slideXml(deck, slide, index, media);
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
  const entries: ZipEntry[] = [
    ...packageParts(deck),
    ...masterParts(deck, media),
    ...slideParts(deck, media),
    ...media.items.map(({ name, data }) => ({
      path: `ppt/media/${name}`,
      data,
    })),
  ];
  return zip(entries);
}
