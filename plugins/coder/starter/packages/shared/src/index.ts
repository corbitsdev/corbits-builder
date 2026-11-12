import { z } from "zod";

// Shapes that cross the wire. The server builds them and the client parses them with the same schema.
export const Health = z.object({ ok: z.boolean(), time: z.iso.datetime() });
export type Health = z.infer<typeof Health>;
