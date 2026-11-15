import { createHash } from "node:crypto";
import { ROOT_CONTEXT, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getLogger } from "@intx/log";
import { createProductConfig } from "../config/index.ts";
import type { FinishedSpan } from "./run-spans.ts";

const log = getLogger(["corbits-builder", "telemetry"]);

// Ids are derived from the turn and span keys, so a child sent before its turn ends still names the
// right parent and no SDK span has to be kept open.
const hexId = (length: 16 | 32, ...parts: string[]) =>
  createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, length);

export function createRunExport(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (
    !environment.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  )
    return undefined;
  let current: FinishedSpan | undefined;
  const provider = new BasicTracerProvider({
    idGenerator: {
      generateTraceId() {
        if (!current) throw new Error("No agent span to export");
        return hexId(32, current.traceKey);
      },
      generateSpanId() {
        if (!current) throw new Error("No agent span to export");
        return hexId(16, current.traceKey, current.key);
      },
    },
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:
        environment.OTEL_SERVICE_NAME ||
        createProductConfig(environment).naming.productName,
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  const tracer = provider.getTracer("corbits-builder");
  return {
    send(spans: FinishedSpan[]): void {
      for (const record of spans) {
        try {
          const parent =
            record.parentKey === undefined
              ? ROOT_CONTEXT
              : trace.setSpanContext(ROOT_CONTEXT, {
                  traceId: hexId(32, record.traceKey),
                  spanId: hexId(16, record.traceKey, record.parentKey),
                  traceFlags: 1,
                });
          current = record;
          const span = tracer.startSpan(
            record.name,
            {
              startTime: record.startTime,
              attributes: record.attributes,
            },
            parent,
          );
          if (record.error !== undefined)
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: record.error,
            });
          span.end(record.endTime);
        } catch (error) {
          log.error("Agent trace export failed", {
            errorType: error instanceof Error ? error.name : typeof error,
          });
        } finally {
          current = undefined;
        }
      }
    },
    async shutdown(): Promise<void> {
      await provider.shutdown();
    },
  };
}
