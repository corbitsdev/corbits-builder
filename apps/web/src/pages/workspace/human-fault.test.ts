import { expect, test } from "bun:test";
import { ProductApiError } from "@corbits-builder/client";
import { humanFault, humanFaultWithCode, responseCode } from "./human-fault.ts";

test("a refusal whose body is not JSON has no code", async () => {
  const page = new Response("<html>Bad gateway</html>", { status: 502 });

  expect(await responseCode(new ProductApiError(page))).toBeUndefined();
});

test("a refusal whose body cannot be read still gets the caller's words", async () => {
  const dropped = new ReadableStream({
    start(controller) {
      controller.error(new TypeError("connection reset"));
    },
  });
  const refusal = new ProductApiError(new Response(dropped, { status: 409 }));

  expect(await humanFaultWithCode(refusal, "Not sent.")).toBe(
    humanFault(refusal, "Not sent."),
  );
});
