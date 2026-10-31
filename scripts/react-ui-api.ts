// Regenerates the react-ui component API reference from the installed @corbits/react-ui
// declarations: one file per component group under workflows/designer/skills/react-ui/reference.
// Run: bun run skills:react-ui
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");
const skills = join(root, "workflows/designer/skills");
const packageJson = Bun.resolveSync(
  "@corbits/react-ui/package.json",
  join(root, "apps/web"),
);
const packageDir = dirname(packageJson);
const version = JSON.parse(readFileSync(packageJson, "utf8")).version as string;
const uiDir = join(packageDir, "dist/ui");
const maxSize = 16_000;

// Modules not listed here are conversation, agent-run, media and artifact components.
const groups = {
  layout: {
    title: "app shell and page layout",
    modules: [
      "boot-screen",
      "card",
      "corbits-mark",
      "inspector-shell",
      "kind-card-grid",
      "library-page-header",
      "list-detail",
      "notifications-bell",
      "now-cards",
      "page-panel",
      "page-shell",
      "panel",
      "panel-tabs",
      "profile-card",
      "section",
      "settings-panel",
      "sidebar",
      "sidebar-item-row",
      "sidebar-panel",
      "sidebar-search",
      "theme-provider",
      "theme-toggle",
      "top-bar",
      "view-toggle",
    ],
  },
  controls: {
    title: "buttons, inputs, filters, dialogs, menus and toasts",
    modules: [
      "bulk-action-bar",
      "button",
      "checkbox",
      "command-palette",
      "confirm-button",
      "dialog",
      "file-input",
      "filter-bar",
      "filter-chip",
      "horizontal-stepper",
      "input",
      "intake-form",
      "menu",
      "run-now-button",
      "select",
      "selection-checkbox",
      "switch",
      "tabs",
      "textarea",
      "toast",
      "tooltip",
    ],
  },
  "data-display": {
    title: "tables, stats, charts, status, avatars, empty and loading states",
    modules: [
      "animated-number",
      "avatar",
      "badge",
      "bar-chart",
      "block-card",
      "category-bars",
      "chart-frame",
      "csv-table",
      "empty-state",
      "gate-block",
      "live-run-banner",
      "live-status-line",
      "progress-checklist",
      "quote-card",
      "rich-empty-state",
      "shimmer-text",
      "skeleton",
      "sortable-table",
      "sparkline",
      "stat-grid",
      "status-dot",
      "step-list",
      "table",
      "time-series-chart",
      "token-mosaic",
      "trace-waterfall",
    ],
  },
  agent: {
    title: "conversation, agent runs, media and artifacts",
    modules: [],
  },
} satisfies Record<string, { title: string; modules: string[] }>;
type Group = keyof typeof groups;
const groupOf = (module: string): Group =>
  (Object.keys(groups) as Group[]).find((group) =>
    (groups[group].modules as readonly string[]).includes(module),
  ) ?? "agent";

const files = readdirSync(uiDir)
  .filter((name) => name.endsWith(".d.ts"))
  .sort()
  .map((name) => join(uiDir, name));
const program = ts.createProgram(files, {
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
});
const checker = program.getTypeChecker();

interface Prop {
  name: string;
  optional: boolean;
  type: string;
  doc: string;
}
interface Component {
  name: string;
  summary: string;
  props: Prop[];
  native: boolean;
}

const printFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteArrowStyleSignature;

const isOwn = (declaration: ts.Declaration) =>
  declaration.getSourceFile().fileName.startsWith(packageDir);

function firstSentence(text: string): string {
  const flat = text
    .replace(/\s+/g, " ")
    .replace(/\b(e\.g|i\.e)\./g, "$1")
    .trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
}

function shortType(text: string): string {
  return text
    .replace(/import\("[^"]*"\)\./g, "")
    .replace(/\bReact\./g, "")
    .replace(
      /string \| number \| bigint \| boolean \| ReactElement<[^|]*?> \| Iterable<ReactNode> \| ReactPortal \| Promise<[^|]*?> \| null \| undefined/g,
      "ReactNode",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function propsOf(
  type: ts.Type,
  location: ts.Node,
): { props: Prop[]; native: boolean } {
  let native = false;
  const props: Prop[] = [];
  for (const symbol of checker.getPropertiesOfType(type)) {
    const declaration = symbol.declarations?.[0];
    if (!declaration || !isOwn(declaration)) {
      native = true;
      continue;
    }
    const propType = checker.getTypeOfSymbolAtLocation(symbol, location);
    props.push({
      name: symbol.name,
      optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
      type: shortType(
        checker.typeToString(propType, undefined, printFlags),
      ).replace(/ \| undefined$/, ""),
      doc: firstSentence(
        ts.displayPartsToString(symbol.getDocumentationComment(checker)),
      ),
    });
  }
  return { props, native };
}

function componentsOf(file: ts.SourceFile): Component[] {
  const moduleSymbol = checker.getSymbolAtLocation(file);
  if (!moduleSymbol) return [];
  const result: Component[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    if (!/^[A-Z]/.test(exported.name)) continue;
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    if (!(symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)))
      continue;
    const declaration = symbol.declarations?.[0];
    if (!declaration) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const propsParam = type.getCallSignatures()[0]?.getParameters()[0];
    const propsType = propsParam
      ? checker.getTypeOfSymbolAtLocation(propsParam, declaration)
      : undefined;
    const { props, native } = propsType
      ? propsOf(propsType, declaration)
      : { props: [], native: false };
    result.push({
      name: exported.name,
      summary: firstSentence(
        ts.displayPartsToString(symbol.getDocumentationComment(checker)),
      ),
      props,
      native,
    });
  }
  return result;
}

const moduleOf = (file: string) =>
  file.slice(uiDir.length + 1).replace(/\.d\.ts$/, "");
const modules = files
  .map((file) => ({
    file,
    components: componentsOf(program.getSourceFile(file)!),
  }))
  .filter(({ components }) => components.length > 0);

function render(group: Group, withPropDocs: boolean): string {
  const lines = [
    `<!-- Generated from @corbits/react-ui ${version}. Regenerate: bun scripts/react-ui-api.ts -->`,
    "",
    `# react-ui: ${groups[group].title} (${version})`,
    "",
    "Props per exported component, from the installed declarations. `?` marks optional. `+native` means the component also accepts the native props of the element it renders (`className`, `onClick`, ...). Import from the package root unless SKILL.md lists the module as a subpath.",
    "",
  ];
  for (const { file, components } of modules) {
    if (groupOf(moduleOf(file)) !== group) continue;
    lines.push(`## ui/${moduleOf(file)}`, "");
    for (const component of components) {
      const tag = component.native ? " +native" : "";
      lines.push(
        `### ${component.name}${tag}${component.summary ? ` — ${component.summary}` : ""}`,
      );
      for (const prop of component.props) {
        const doc = withPropDocs && prop.doc ? ` — ${prop.doc}` : "";
        lines.push(
          `${prop.name}${prop.optional ? "?" : ""}: ${prop.type}${doc}`,
        );
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function write(out: string, content: string) {
  writeFileSync(out, content);
  console.log(`${out}: ${content.length} characters`);
}

for (const group of Object.keys(groups) as Group[]) {
  let content = render(group, true);
  if (content.length > maxSize) content = render(group, false);
  write(join(skills, `react-ui/reference/api-${group}.md`), content);
}
