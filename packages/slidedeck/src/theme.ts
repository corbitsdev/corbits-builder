import type { Theme } from "./deck.ts";
import { XML_DECLARATION, escapeXml } from "./xml.ts";

const hex = (color: string) => color.replace("#", "").toUpperCase();
const srgb = (color: string) => `<a:srgbClr val="${hex(color)}"/>`;

export const COLOR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const placeholderStyles = (tag: string, count: number) =>
  `<a:${tag}>${Array.from({ length: count }, () => '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("")}</a:${tag}>`;

/** A theme part; scheme colours map dk1 to text, lt1 to background and the accents in token order. */
export function themeXml({ colors, fonts }: Theme, name: string) {
  const accents = [colors.primary, colors.secondary, colors.accent];
  const scheme = [
    `<a:dk1>${srgb(colors.text)}</a:dk1>`,
    `<a:lt1>${srgb(colors.background)}</a:lt1>`,
    `<a:dk2>${srgb(colors.muted)}</a:dk2>`,
    `<a:lt2>${srgb(colors.background)}</a:lt2>`,
    ...[...accents, ...accents].map(
      (color, index) =>
        `<a:accent${index + 1}>${srgb(color)}</a:accent${index + 1}>`,
    ),
    `<a:hlink>${srgb(colors.primary)}</a:hlink>`,
    `<a:folHlink>${srgb(colors.muted)}</a:folHlink>`,
  ].join("");
  const font = (typeface: string) =>
    `<a:latin typeface="${escapeXml(typeface)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const line =
    '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
  const effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
  return `${XML_DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements><a:clrScheme name="${name}">${scheme}</a:clrScheme><a:fontScheme name="${name}"><a:majorFont>${font(fonts.heading)}</a:majorFont><a:minorFont>${font(fonts.body)}</a:minorFont></a:fontScheme><a:fmtScheme name="${name}">${placeholderStyles("fillStyleLst", 3)}<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst><a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>${placeholderStyles("bgFillStyleLst", 3)}</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
