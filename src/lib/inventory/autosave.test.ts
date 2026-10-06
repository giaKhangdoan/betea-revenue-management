import { describe, expect, it } from "vitest";
import { collectInventoryDraftChanges, queueInventorySave } from "./autosave";

describe("collectInventoryDraftChanges", () => {
  it("submits unchanged quantities for an explicit recount and keeps ordinary unchanged fields out", () => {
    const result = collectInventoryDraftChanges({
      current: {
        same: { large: "", small: "0" },
        changed: { large: "2", small: "" },
      },
      saved: {
        same: { large: "", small: "0" },
        changed: { large: "1", small: "" },
      },
      dirty: {
        same: { small: true },
        changed: { large: true },
      },
      recountItemIds: ["same"],
    });

    expect(result.changes).toEqual([
      { item_id: "same", large_quantity: null, small_quantity: "0" },
      { item_id: "changed", large_quantity: "2" },
    ]);
    expect(result.dirty).toEqual({ changed: { large: true } });
  });
});

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
