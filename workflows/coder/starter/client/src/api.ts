import { useQuery } from "@tanstack/react-query";
import { Health } from "@app/shared";
import type { z } from "zod";

async function parsed<T>(
  response: Response,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `${path} answered ${response.status}`;
    throw new Error(message);
  }
  return schema.parse(await response.json());
}

// Every response is parsed with its shared schema, so a wrong shape fails here instead of deep in the UI.
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return parsed(await fetch(path), path, schema);
}

// Writes go through here; use them from a useMutation whose onSuccess invalidates the queries it changed.
export async function sendJson<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parsed(response, path, schema);
}

export const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => getJson("/api/health", Health),
  });
