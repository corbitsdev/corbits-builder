import { expect, test } from "bun:test";
import { digitalOcean, type Client } from "./api.ts";
import { ProviderRefused, ProviderUnavailable, SignedOut } from "./vendor.ts";

// DigitalOcean's API answering each call from answer, as the run's sign-in reaches it, and the
// paths asked; a refused sign-in's waits never really sleep.
function api(answer: (path: string) => Response) {
  const asked: string[] = [];
  const capabilities = {
    resolve: () => ({
      resolve: async () => ({
        kind: "http",
        fetch: async (path: string) => {
          asked.push(path);
          return answer(path);
        },
        dispose() {},
      }),
    }),
  } as unknown as Client["capabilities"];
  const vendor = digitalOcean({
    capabilities,
    handle: "digitalocean",
    signal: new AbortController().signal,
    sleep: async () => undefined,
  });
  return { vendor, asked };
}

test("a droplet reads as a server by its public address, and an id DigitalOcean does not know as gone", async () => {
  const { vendor } = api((path) =>
    path.endsWith("/700")
      ? Response.json({
          droplet: {
            id: 700,
            name: "builder-a1",
            status: "active",
            networks: {
              v4: [
                { ip_address: "10.110.0.2", type: "private" },
                { ip_address: "203.0.113.7", type: "public" },
              ],
            },
          },
        })
      : Response.json(
          { id: "not_found", message: "not found" },
          { status: 404 },
        ),
  );
  expect(await vendor.server("700")).toEqual({
    id: "700",
    name: "builder-a1",
    state: "running",
    address: "203.0.113.7",
  });
  expect(await vendor.server("701")).toBeUndefined();
});

test("a failed call reads as signed out, refused with DigitalOcean's words, or unavailable", async () => {
  const failing = async (response: () => Response) => {
    try {
      await api(response).vendor.find("builder-a1");
    } catch (error) {
      return error;
    }
    throw new Error("the call did not fail");
  };
  expect(
    await failing(() => Response.json({ id: "unauthorized" }, { status: 401 })),
  ).toBeInstanceOf(SignedOut);
  const refused = await failing(() =>
    Response.json(
      { id: "forbidden", message: "You are\nnot allowed" },
      { status: 403 },
    ),
  );
  expect(refused).toBeInstanceOf(ProviderRefused);
  expect(refused).toMatchObject({ status: 403, words: "You are not allowed" });
  for (const response of [
    () => new Response("down", { status: 503 }),
    () => Response.json({ id: "too_many_requests" }, { status: 429 }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      }),
    () => new Response("<html>", { status: 200 }),
    () => Response.json({ unexpected: true }),
  ])
    expect(await failing(response)).toBeInstanceOf(ProviderUnavailable);
});

test("every page of the account's keys is read before the login key's entry is dropped", async () => {
  const { vendor, asked } = api((path) => {
    const url = new URL(path, "https://api.digitalocean.com");
    if (url.pathname.startsWith("/v2/account/keys/"))
      return new Response(null, { status: 204 });
    const page = url.searchParams.get("page");
    return Response.json({
      ssh_keys: [
        {
          id: page === "1" ? 1 : 2,
          name: page === "1" ? "someone-else" : "builder-a1",
          public_key: "ssh-ed25519 AAAA",
        },
      ],
      links: page === "1" ? { pages: { next: "page=2" } } : {},
    });
  });
  await vendor.settle("builder-a1");
  expect(asked.filter((path) => path.startsWith("/v2/account/keys/"))).toEqual([
    "/v2/account/keys/2",
  ]);
});
