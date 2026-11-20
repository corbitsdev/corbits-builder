import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  type Sink,
} from "@logtape/logtape";
import { getOpenTelemetrySink } from "@logtape/otel";
import {
  createProductConfig,
  type ProductConfigEnvironment,
} from "./config/index.ts";
import type { HubEnvironment } from "./environment.ts";
import { requestContext } from "./middleware/correlation.ts";

type LoggingEnvironment = Pick<
  HubEnvironment,
  | "LOG_LEVEL"
  | "OTEL_EXPORTER_OTLP_ENDPOINT"
  | "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"
  | "OTEL_SERVICE_NAME"
> &
  ProductConfigEnvironment;

const sinkFactories: Record<
  string,
  (environment: LoggingEnvironment) => Sink | undefined
> = {
  console: () => getConsoleSink({ formatter: getJsonLinesFormatter() }),
  // The exporter reads the endpoint, protocol and headers from the OTEL_* environment itself.
  otel: (environment) =>
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ||
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
      ? getOpenTelemetrySink({
          serviceName:
            environment.OTEL_SERVICE_NAME ||
            createProductConfig(environment).naming.productName,
        })
      : undefined,
};

function createSinks(environment: LoggingEnvironment): Record<string, Sink> {
  return Object.fromEntries(
    Object.entries(sinkFactories).flatMap(([name, create]) => {
      const sink = create(environment);
      return sink ? [[name, sink]] : [];
    }),
  );
}

export async function setupHubLogging(environment: LoggingEnvironment) {
  const lowestLevel = environment.LOG_LEVEL;
  const sinks = createSinks(environment);
  await configure({
    reset: true,
    contextLocalStorage: requestContext,
    sinks,
    loggers: [
      { category: [], lowestLevel, sinks: Object.keys(sinks) },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  });
}
