/** A body's JSON, or undefined when it is not JSON; any other read failure propagates. */
export async function readJson(body: {
  json(): Promise<unknown>;
}): Promise<unknown> {
  try {
    return await body.json();
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** The text's JSON, or undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
