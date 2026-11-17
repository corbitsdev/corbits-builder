import { describe, expect, test } from "bun:test";
import { createHeaderCredentialProvider } from "./credential-providers";

const origin = "https://api.example.com";

describe("createHeaderCredentialProvider", () => {
  for (const requestInput of [false, true]) {
    test(`sends the key in its header with its prefix (${requestInput ? "Request" : "URL/init"})`, async () => {
      const sent: Request[] = [];
      const credential = createHeaderCredentialProvider({
        fetch: async (input, init) => {
          sent.push(new Request(input, init));
          return new Response("ok");
        },
      }).shape({
        origin,
        readCurrentMaterial: () => ({
          secret: JSON.stringify({
            header: "x-api-key",
            prefix: "Token",
            value: "the-key",
          }),
        }),
      });

      await credential.fetch(
        requestInput ? new Request(`${origin}/resource`) : "/resource",
      );
      expect(sent[0]?.headers.get("x-api-key")).toBe("Token the-key");
      expect(sent[0]?.redirect).toBe("manual");
    });
  }

  test("refuses cross-origin requests before reading the secret", async () => {
    let reads = 0;
    let fetches = 0;
    const credential = createHeaderCredentialProvider({
      fetch: async () => {
        fetches++;
        return new Response("unexpected");
      },
    }).shape({
      origin,
      readCurrentMaterial: () => {
        reads++;
        throw new Error("must not read material");
      },
    });

    await expect(
      credential.fetch("https://other.example.com/resource"),
    ).rejects.toThrow("refusing cross-origin request");
    expect(reads).toBe(0);
    expect(fetches).toBe(0);
  });

  test("rejects malformed secrets without including their values", async () => {
    const marker = "private-test-value";
    let secret = "";
    const credential = createHeaderCredentialProvider({
      fetch: async () => new Response("unexpected"),
    }).shape({ origin, readCurrentMaterial: () => ({ secret }) });

    for (const malformed of [
      `${marker}{`,
      JSON.stringify({ value: marker }),
      JSON.stringify({ header: "invalid header", value: marker }),
      JSON.stringify({ header: "x-api-key", prefix: marker, value: "" }),
      JSON.stringify({ header: "x-api-key", value: `${marker}\r\ninjected` }),
    ]) {
      secret = malformed;
      let message = "";
      try {
        await credential.fetch("/resource");
      } catch (caught) {
        if (caught instanceof Error) message = caught.message;
      }
      expect(message).toContain("Invalid http-header credential");
      expect(message).not.toContain(marker);
    }
  });
});
