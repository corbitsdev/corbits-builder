/**
 * The hub transport: the typed `ProductApiClient` (`@corbits-builder/client`)
 * on the hub origin with cookies included. Better-auth's own endpoints are
 * the one other HTTP path (`auth.ts`).
 */
import {
  createProductApiClient,
  ProductApiError,
  type ProductApiClient,
} from "@corbits-builder/client";
import { hubCredentials, hubOrigin } from "./origin.ts";

/**
 * A refusal's body as JSON; undefined when it is not JSON, such as a proxy's
 * error page, or when the connection dropped while it was read, so the caller
 * still says the refusal in its own words.
 */
export async function refusalBody(cause: ProductApiError): Promise<unknown> {
  try {
    return await cause.response.clone().json();
  } catch (failure) {
    if (failure instanceof SyntaxError) return undefined;
    if (!(failure instanceof TypeError || failure instanceof DOMException))
      throw failure;
    console.warn("A refusal's body could not be read.", failure);
    return undefined;
  }
}

let client: ProductApiClient | undefined;

/** The typed client against the hub origin, cookies included. */
export function productClient(): ProductApiClient {
  return (client ??= createProductApiClient({
    baseUrl: hubOrigin(),
    credentials: hubCredentials(),
  }));
}
