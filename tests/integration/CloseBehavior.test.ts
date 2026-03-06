import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SessionRegistry } from "../../src/session/SessionRegistry";

const noticeMessages: string[] = [];

mock.module("obsidian", () => {
  class Notice {
    constructor(message?: string) {
      if (message) {
        noticeMessages.push(message);
      }
    }
  }

  class Plugin {}

  return {
    App: class App {},
    EventRef: class EventRef {},
    ItemView: class ItemView {},
    MarkdownView: class MarkdownView {},
    Notice,
    Plugin,
    PluginSettingTab: class PluginSettingTab {},
    Setting: class Setting {},
    WorkspaceLeaf: class WorkspaceLeaf {},
    addIcon: () => {},
    setIcon: () => {},
  };
});

const { default: OpenCodePlugin } = await import("../../src/main");

type FakeLeaf = {
  id: string;
  detachCalls: number;
  detach: () => void;
};

function createLeaf(id: string): FakeLeaf {
  return {
    id,
    detachCalls: 0,
    detach() {
      this.detachCalls += 1;
    },
  };
}

function createPluginHarness(params?: {
  defaultViewLocation?: "sidebar" | "main";
  closeResults?: Record<string, boolean>;
  serverState?: "running" | "stopped";
}) {
  const plugin = Object.create(OpenCodePlugin.prototype) as OpenCodePlugin & Record<string, any>;
  const closeResults = params?.closeResults ?? {};
  const calls = {
    activatedSessionIds: [] as string[],
    openNewSessionViewCount: 0,
    notifySessionTabsChangeCount: 0,
  };

  plugin.settings = {
    defaultViewLocation: params?.defaultViewLocation ?? "sidebar",
  };
  plugin.sessionRegistry = new SessionRegistry<FakeLeaf>();
  plugin.closingSessionIds = new Set<string>();
  plugin.sessionTabsCallbacks = [];
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      revealLeaf: () => {},
    },
  };

  plugin.getServerState = () => params?.serverState ?? "running";
  plugin.pruneStaleSessionLeaves = () => {};
  plugin.notifySessionTabsChange = () => {
    calls.notifySessionTabsChangeCount += 1;
  };
  plugin.openNewSessionView = async () => {
    calls.openNewSessionViewCount += 1;
  };
  plugin.activateSession = async (sessionId: string) => {
    calls.activatedSessionIds.push(sessionId);
  };
  plugin.closeSessionOnServer = async (sessionId: string) => closeResults[sessionId] ?? true;
  plugin.unregisterLeafSessions = OpenCodePlugin.prototype.unregisterLeafSessions;
  plugin.closeSession = OpenCodePlugin.prototype.closeSession;
  plugin.closeSessionsForLeaf = OpenCodePlugin.prototype.closeSessionsForLeaf;

  return { plugin, calls };
}

describe("OpenCode close behavior", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  test("closing active session switches to fallback session when server close succeeds", async () => {
    const { plugin, calls } = createPluginHarness({
      defaultViewLocation: "sidebar",
      closeResults: { "session-1": true },
    });
    const leaf = createLeaf("leaf-1");
    plugin.sessionRegistry.register("session-1", leaf);
    plugin.sessionRegistry.register("session-2", leaf);

    await plugin.closeSession("session-1", "session-1");

    expect(plugin.sessionRegistry.getSessionIds()).toEqual(["session-2"]);
    expect(calls.activatedSessionIds).toEqual(["session-2"]);
    expect(noticeMessages).toEqual([]);
  });

  test("failing server close keeps tab/session registered and shows warning", async () => {
    const { plugin, calls } = createPluginHarness({
      defaultViewLocation: "sidebar",
      closeResults: { "session-1": false },
    });
    const leaf = createLeaf("leaf-1");
    plugin.sessionRegistry.register("session-1", leaf);
    plugin.sessionRegistry.register("session-2", leaf);

    await plugin.closeSession("session-1", "session-1");

    expect(plugin.sessionRegistry.getSessionIds()).toEqual(["session-1", "session-2"]);
    expect(calls.activatedSessionIds).toEqual([]);
    expect(noticeMessages).toEqual(["Failed to close OpenCode session. Please retry."]);
  });

  test("closing non-active session in main mode detaches dedicated leaf", async () => {
    const { plugin, calls } = createPluginHarness({
      defaultViewLocation: "main",
      closeResults: { "session-2": true },
    });
    const leaf1 = createLeaf("leaf-1");
    const leaf2 = createLeaf("leaf-2");
    plugin.sessionRegistry.register("session-1", leaf1);
    plugin.sessionRegistry.register("session-2", leaf2);

    await plugin.closeSession("session-2", "session-1");

    expect(plugin.sessionRegistry.getSessionIds()).toEqual(["session-1"]);
    expect(leaf2.detachCalls).toBe(1);
    expect(leaf1.detachCalls).toBe(0);
    expect(calls.activatedSessionIds).toEqual([]);
  });

  test("closing the last session auto-opens a new session view", async () => {
    const { plugin, calls } = createPluginHarness({
      defaultViewLocation: "sidebar",
      closeResults: { "session-1": true },
    });
    const leaf = createLeaf("leaf-1");
    plugin.sessionRegistry.register("session-1", leaf);

    await plugin.closeSession("session-1", "session-1");

    expect(plugin.sessionRegistry.getSessionIds()).toEqual([]);
    expect(calls.openNewSessionViewCount).toBe(1);
  });

  test("pane close uses best-effort session close and warns on failures", async () => {
    const { plugin } = createPluginHarness({
      defaultViewLocation: "sidebar",
      closeResults: {
        "session-1": true,
        "session-2": false,
        "session-3": true,
      },
      serverState: "running",
    });
    const leaf = createLeaf("leaf-1");
    plugin.sessionRegistry.register("session-1", leaf);
    plugin.sessionRegistry.register("session-2", leaf);
    plugin.sessionRegistry.register("session-3", leaf);

    await plugin.closeSessionsForLeaf(leaf);

    expect(plugin.sessionRegistry.getSessionIdsForLeaf(leaf)).toEqual([]);
    expect(noticeMessages).toEqual([
      "Failed to close 1 OpenCode session on server.",
    ]);
  });
});
