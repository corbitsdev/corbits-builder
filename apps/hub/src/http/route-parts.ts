import { readJson } from "../lib/json.ts";
import { ProjectError } from "../projects/errors.ts";

export const security = [
  { sessionCookie: [] },
  { deviceBearer: [] },
  { coordinatorBearer: [] },
];

export const body = async (c: { req: { json(): Promise<unknown> } }) => {
  const json = await readJson(c.req);
  if (json === undefined) throw new ProjectError(400, "invalid_json");
  return json;
};
