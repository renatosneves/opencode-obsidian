import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../../src/session/SessionRegistry";

type FakeLeaf = { id: string };

describe("SessionRegistry", () => {
  test("registers first and second sessions with sequential labels", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("view-1", { id: "leaf-1" }, "session-1");
    registry.register("view-2", { id: "leaf-2" }, "session-2");

    const tabs = registry.getTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toEqual({
      sessionId: "session-1",
      label: "Session 1",
      isActive: false,
    });
    expect(tabs[1]).toEqual({
      sessionId: "session-2",
      label: "Session 2",
      isActive: false,
    });
  });

  test("unregistering a view removes its session tab", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("view-1", { id: "leaf-1" }, "session-1");
    registry.register("view-2", { id: "leaf-2" }, "session-2");

    expect(registry.unregisterView("view-1")).toBe(true);
    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-2",
        label: "Session 1",
        isActive: false,
      },
    ]);
  });

  test("labels are compacted after closing a session", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("view-1", { id: "leaf-1" }, "session-1");
    registry.register("view-2", { id: "leaf-2" }, "session-2");

    registry.unregisterView("view-1");
    registry.register("view-3", { id: "leaf-3" }, "session-3");

    expect(registry.getTabs()).toEqual([
      {
        sessionId: "session-2",
        label: "Session 1",
        isActive: false,
      },
      {
        sessionId: "session-3",
        label: "Session 2",
        isActive: false,
      },
    ]);
  });

  test("re-registering same view and session does not duplicate tabs", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("view-1", { id: "leaf-1" }, "session-1");
    registry.register("view-1", { id: "leaf-1b" }, "session-1");

    const tabs = registry.getTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe("Session 1");
  });

  test("resolving unknown session returns null and keeps state unchanged", () => {
    const registry = new SessionRegistry<FakeLeaf>();

    registry.register("view-1", { id: "leaf-1" }, "session-1");
    const before = registry.getTabs();

    expect(registry.resolveLeaf("missing-session")).toBeNull();
    expect(registry.getTabs()).toEqual(before);
  });
});
