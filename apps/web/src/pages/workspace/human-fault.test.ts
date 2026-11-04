import { expect, test } from "bun:test";
import { ProductApiError } from "@corbits-builder/client";
import { responseCode } from "./human-fault.ts";

test("a refusal whose body is not JSON has no code", async () => {
  const page = new Response("<html>Bad gateway</html>", { status: 502 });

  expect(await responseCode(new ProductApiError(page))).toBeUndefined();
});

test("a refusal whose body cannot be read fails instead of passing for one without a code", async () => {
  const dropped = new ReadableStream({
    start(controller) {
      controller.error(new TypeError("connection reset"));
    },
  });
  const refusal = new Response(dropped, { status: 409 });

  await expect(responseCode(new ProductApiError(refusal))).rejects.toThrow(
    "connection reset",
  );
});
