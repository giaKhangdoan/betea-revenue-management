import { describe, expect, it } from "vitest";
import { queueInventorySave } from "./autosave";

describe("queueInventorySave", () => {
  it("waits for an in-flight save before starting the next one", async () => {
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const events: string[] = [];

    const first = queueInventorySave(Promise.resolve(), async () => {
      events.push("first started");
      signalFirstStarted();
      await firstGate;
      events.push("first finished");
    });
    const second = queueInventorySave(first, async () => { events.push("second started"); });

    await firstStarted;
    expect(events).toEqual(["first started"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first started", "first finished", "second started"]);
  });
});
