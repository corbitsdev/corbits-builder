import type { HubEnvironment } from "../environment.ts";

export type ProductConfigEnvironment = Partial<
  Pick<
    HubEnvironment,
    "PRODUCT_CONFIGURED_NAMING" | "PRODUCT_NAME" | "PRODUCT_HELLO_WORDING"
  >
>;

export type ProductConfig = Readonly<{
  features: Readonly<{
    configuredNaming: boolean;
  }>;
  naming: Readonly<{ productName: string }>;
  wording: Readonly<{ hello: string }>;
}>;

const neutralProductName = "Builder";

export function createProductConfig(
  environment: ProductConfigEnvironment = {},
): ProductConfig {
  const configuredNaming = environment.PRODUCT_CONFIGURED_NAMING ?? false;
  const productName = configuredNaming
    ? (environment.PRODUCT_NAME ?? neutralProductName)
    : neutralProductName;
  const neutralHello = `Hello from ${productName}`;
  const hello = configuredNaming
    ? (environment.PRODUCT_HELLO_WORDING ?? neutralHello)
    : neutralHello;

  return Object.freeze({
    features: Object.freeze({
      configuredNaming,
    }),
    naming: Object.freeze({ productName }),
    wording: Object.freeze({
      hello,
    }),
  });
}

// Explicit environment injection prevents a client bundle from reading server secrets.
export const productConfig = createProductConfig();
