export type ProductConfigEnvironment = Readonly<{
  [key: string]: string | undefined;
  PRODUCT_CONFIGURED_NAMING?: string | undefined;
  PRODUCT_NAME?: string | undefined;
  PRODUCT_HELLO_WORDING?: string | undefined;
}>;

export type ProductConfig = Readonly<{
  features: Readonly<{
    configuredNaming: boolean;
  }>;
  naming: Readonly<{ productName: string }>;
  wording: Readonly<{ hello: string }>;
}>;

const neutralProductName = "Builder";

function toggle(
  environment: ProductConfigEnvironment,
  key: keyof ProductConfigEnvironment,
): boolean {
  const value = environment[key] ?? "false";
  if (value !== "true" && value !== "false")
    throw new Error(`${key} must be true or false.`);
  return value === "true";
}

export function createProductConfig(
  environment: ProductConfigEnvironment = {},
): ProductConfig {
  const configuredNaming = toggle(environment, "PRODUCT_CONFIGURED_NAMING");
  const productName = configuredNaming
    ? environment.PRODUCT_NAME?.trim() || neutralProductName
    : neutralProductName;
  const neutralHello = `Hello from ${productName}`;
  const hello = configuredNaming
    ? environment.PRODUCT_HELLO_WORDING?.trim() || neutralHello
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
