export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too-large" | "invalid" };

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<BoundedJsonResult> {
  if (!request.body) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // Return the size error even if the client already closed the stream.
        }
        return { ok: false, reason: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The request stream may already be closed.
    }
    return { ok: false, reason: "invalid" };
  }
}
