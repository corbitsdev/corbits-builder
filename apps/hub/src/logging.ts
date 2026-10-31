import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogLevels,
  isLogLevel,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";
import { getOpenTelemetrySink } from "@logtape/otel";
import { createProductConfig } from "./config/index.ts";
import { requestContext } from "./middleware/correlation.ts";

type LoggingEnvironment = Readonly<Record<string, string | undefined>>;

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

function readLogLevel(environment: LoggingEnvironment): LogLevel {
  const level = environment.LOG_LEVEL ?? "info";
  if (!isLogLevel(level))
    throw new Error(`LOG_LEVEL must be one of ${getLogLevels().join(", ")}.`);
  return level;
}

export async function setupHubLogging(
  environment: LoggingEnvironment = process.env,
) {
  const lowestLevel = readLogLevel(environment);
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
