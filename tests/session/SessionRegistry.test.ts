import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../../src/session/SessionRegistry";

type FakeLeaf = { id: string };

describe("SessionRegistry", () => {
  test("registers first and second sessions with sequential labels", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("session-1", { id: "leaf-1" });
    registry.register("session-2", { id: "leaf-2" });

    const tabs = registry.getTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toEqual({
      sessionId: "session-1",
      label: "Session 1",
      isActive: false,
      isRunning: false,
    });
    expect(tabs[1]).toEqual({
      sessionId: "session-2",
      label: "Session 2",
      isActive: false,
      isRunning: false,
    });
  });

  test("unregistering a view removes its session tab", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    const leaf1 = { id: "leaf-1" };
    const leaf2 = { id: "leaf-2" };

    registry.register("session-1", leaf1);
    registry.register("session-2", leaf2);

    expect(registry.unregisterSessionsForLeaf(leaf1)).toBe(true);
    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-2",
        label: "Session 1",
        isActive: false,
        isRunning: false,
      },
    ]);
  });

  test("labels are compacted after closing a session", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    const leaf1 = { id: "leaf-1" };
    const leaf2 = { id: "leaf-2" };
    const leaf3 = { id: "leaf-3" };

    registry.register("session-1", leaf1);
    registry.register("session-2", leaf2);

    registry.unregisterSessionsForLeaf(leaf1);
    registry.register("session-3", leaf3);

    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-2",
        label: "Session 1",
        isActive: false,
        isRunning: false,
      },
      {
        sessionId: "session-3",
        label: "Session 2",
        isActive: false,
        isRunning: false,
      },
    ]);
  });

  test("unregistering a single session removes only that session", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    const leaf = { id: "leaf-1" };

    registry.register("session-1", leaf);
    registry.register("session-2", leaf);

    expect(registry.unregisterSession("session-1")).toBe(true);
    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-2",
        label: "Session 1",
        isActive: false,
        isRunning: false,
      },
    ]);
  });

  test("running sessions are marked and can be reset", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    registry.register("session-1", { id: "leaf-1" });

    expect(registry.setSessionRunning("session-1", true)).toBe(true);
    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-1",
        label: "Session 1",
        isActive: false,
        isRunning: true,
      },
    ]);

    expect(registry.clearRunningStates()).toBe(true);
    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-1",
        label: "Session 1",
        isActive: false,
        isRunning: false,
      },
    ]);
  });

  test("re-registering same session on a leaf does not duplicate tabs", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("session-1", { id: "leaf-1" });
    registry.register("session-1", { id: "leaf-1b" });

    const tabs = registry.getTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe("Session 1");
  });

  test("resolving unknown session returns null and keeps state unchanged", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("session-1", { id: "leaf-1" });
    const before = registry.getTabs();

    expect(registry.resolveLeaf("missing-session")).toBeNull();
    expect(registry.getTabs()).toEqual(before);
  });

  test("returns session ids bound to a specific leaf in tab order", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    const leaf1 = { id: "leaf-1" };
    const leaf2 = { id: "leaf-2" };

    registry.register("session-1", leaf1);
    registry.register("session-2", leaf2);
    registry.register("session-3", leaf1);

    expect(registry.getSessionIdsForLeaf(leaf1)).toEqual([
      "session-1",
      "session-3",
    ]);
    expect(registry.getSessionIdsForLeaf(leaf2)).toEqual(["session-2"]);
  });

  test("returns empty array for leaf with no sessions", () => {
    const registry = new SessionRegistry<FakeLeaf>();
    const existingLeaf = { id: "leaf-1" };
    const missingLeaf = { id: "leaf-missing" };

    registry.register("session-1", existingLeaf);

    expect(registry.getSessionIdsForLeaf(missingLeaf)).toEqual([]);
  });
});
