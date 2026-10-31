/**
 * The approaches a document version filed, as columns to weigh side by side.
 * Choosing one approves the version's open ask, if any, and sends the coordinator a plain message,
 * as the composer would.
 */
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@corbits/react-ui";
import type {
  Approach,
  ApproachesMeta,
} from "@corbits-builder/schemas/approaches";
import { useState } from "react";
import { wording } from "../../config.ts";

const text = wording.approaches;

function Points({ label, points }: { label: string; points: string[] }) {
  if (points.length === 0) return null;
  return (
    <div className="approach-points">
      <h4>{label}</h4>
      <ul>
        {points.map((point, index) => (
          <li key={index}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

export function ApproachesComparison({
  meta,
  chosen,
  onChoose,
}: {
  meta: ApproachesMeta;
  /** The approach the person already chose for this version. */
  chosen?: string | undefined;
  /** Sends the person's choice, resolving to a fault or null; absent where choosing is closed, such as an archived project or an earlier version. */
  onChoose?: ((message: string) => Promise<string | null>) | undefined;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const choose = (approach: Approach) => {
    if (onChoose === undefined) return;
    setChoosing(approach.id);
    setFault(null);
    void onChoose(text.message(approach.name))
      .then(setFault)
      .catch(() => setFault(text.notSent))
      .finally(() => setChoosing(null));
  };
  return (
    <section className="approaches" aria-label={text.label}>
      <div className="approaches-grid">
        {meta.approaches.map((approach) => {
          const recommended = approach.id === meta.recommended;
          const picked = approach.id === chosen;
          return (
            <Card
              key={approach.id}
              className="approach-card"
              {...(picked || (recommended && chosen === undefined)
                ? { "data-emphasis": "" }
                : {})}
            >
              <CardHeader>
                <div className="approach-badges">
                  {picked ? <Badge tone="success">{text.chosen}</Badge> : null}
                  {recommended ? (
                    <Badge tone="accent">{text.recommended}</Badge>
                  ) : null}
                  <Badge tone="neutral">{text.effort[approach.effort]}</Badge>
                </div>
                <CardTitle>{approach.name}</CardTitle>
                <CardDescription>{approach.summary}</CardDescription>
              </CardHeader>
              <p className="approach-best-for">
                <strong>{text.bestFor}:</strong> {approach.bestFor}
              </p>
              <Points label={text.pros} points={approach.pros} />
              <Points label={text.cons} points={approach.cons} />
              <Points label={text.risks} points={approach.risks} />
              {onChoose === undefined || chosen !== undefined ? null : (
                <CardFooter className="approach-footer">
                  <Button
                    size="sm"
                    variant={recommended ? "primary" : "outline"}
                    disabled={choosing !== null}
                    onClick={() => choose(approach)}
                  >
                    {choosing === approach.id ? text.choosing : text.choose}
                  </Button>
                </CardFooter>
              )}
            </Card>
          );
        })}
      </div>
      {fault === null ? null : (
        <p className="inline-note" role="alert">
          {fault}
        </p>
      )}
    </section>
  );
}
