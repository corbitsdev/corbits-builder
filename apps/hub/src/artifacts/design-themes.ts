import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { and, eq } from "drizzle-orm";
import type { TenantEnv } from "@intx/hub-api";
import type { DB } from "@intx/db";
import { principal } from "@intx/db/schema";
import {
  DesignDraft,
  DesignThemeList,
} from "@corbits-builder/schemas/artifact";
import { designThemes } from "@corbits-builder/designer/skills" with { type: "macro" };
import { DESIGN_THEMES, themeOf } from "../config/design.ts";
import { designConcept } from "../db/schema.ts";
import { actorOf, authorizeProject } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import type { Actor } from "../lib/actor.ts";

const BUNDLES = designThemes();

const security = [
  { sessionCookie: [] },
  { deviceBearer: [] },
  { coordinatorBearer: [] },
];

export function mountDesignThemeRoutes(app: Hono<TenantEnv>, db: DB["db"]) {
  const readable = (actor: Actor, projectId: string) =>
    authorizeProject(db, actor, projectId, "read");

  app.get(
    "/:projectId/design-themes",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listDesignThemes",
      description:
        "The prebuilt design themes a person can preview and pick before any design exists, each a catalog design concept with a sample design of its own. Picking one is a message to the coordinator; nothing here records a choice.",
      security,
      responses: {
        200: {
          description: "Themes in catalog order",
          content: {
            "application/json": { schema: resolver(DesignThemeList) },
          },
        },
      },
    }),
    async (c) => {
      await readable(actorOf(c), c.req.param("projectId"));
      return c.json({
        themes: DESIGN_THEMES.map(({ id, label, direction }) => ({
          id,
          label,
          direction,
        })),
      });
    },
  );

  // The calling designer run's own theme: the one its concept names, when there is one.
  app.get(
    "/:projectId/design-themes/run",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readRunDesignTheme",
      description:
        "The sample design the calling designer run's workspace starts from: the theme its design concept names.",
      security,
      responses: {
        200: {
          description: "The theme's design bundle: DESIGN.md and designs/",
          content: { "application/json": { schema: resolver(DesignDraft) } },
        },
        404: {
          description:
            "The caller is not a designer run whose concept has a theme",
        },
      },
    }),
    async (c) => {
      const actor = actorOf(c);
      await readable(actor, c.req.param("projectId"));
      const [run] = await db
        .select({ label: designConcept.label })
        .from(principal)
        .innerJoin(designConcept, eq(designConcept.runId, principal.refId))
        .where(
          and(
            eq(principal.id, actor.principalId),
            eq(designConcept.tenantId, actor.tenantId),
          ),
        );
      const theme = run && themeOf(run.label);
      if (!theme) throw new ProjectError(404, "design_theme_not_found");
      return c.json({ files: BUNDLES[theme.id] });
    },
  );

  app.get(
    "/:projectId/design-themes/:themeId",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readDesignTheme",
      description:
        "One design theme's sample design, to preview and tweak before picking it.",
      security,
      responses: {
        200: {
          description: "The theme's design bundle: DESIGN.md and designs/",
          content: { "application/json": { schema: resolver(DesignDraft) } },
        },
        404: { description: "No theme has this id" },
      },
    }),
    async (c) => {
      await readable(actorOf(c), c.req.param("projectId"));
      const themeId = c.req.param("themeId");
      const files = Object.hasOwn(BUNDLES, themeId)
        ? BUNDLES[themeId]
        : undefined;
      if (!files) throw new ProjectError(404, "design_theme_not_found");
      return c.json({ files });
    },
  );
}
