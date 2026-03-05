import { App, WorkspaceLeaf } from "obsidian";
import { OPENCODE_VIEW_TYPE, OpenCodeSettings } from "../types";
import { OpenCodeView } from "./OpenCodeView";
import { OpenCodeClient } from "../client/OpenCodeClient";
import { ContextManager } from "../context/ContextManager";
import { ServerState } from "../server/types";

type ViewManagerDeps = {
  app: App;
  settings: OpenCodeSettings;
  client: OpenCodeClient;
  contextManager: ContextManager;
  getServerState: () => ServerState;
  registerSessionForView: (
    viewId: string,
    leaf: WorkspaceLeaf,
    sessionId: string
  ) => void;
};

export class ViewManager {
  private app: App;
  private settings: OpenCodeSettings;
  private client: OpenCodeClient;
  private contextManager: ContextManager;
  private getServerState: () => ServerState;
  private registerSessionForView: (
    viewId: string,
    leaf: WorkspaceLeaf,
    sessionId: string
  ) => void;

  constructor(deps: ViewManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.client = deps.client;
    this.contextManager = deps.contextManager;
    this.getServerState = deps.getServerState;
    this.registerSessionForView = deps.registerSessionForView;
  }

  updateSettings(settings: OpenCodeSettings): void {
    this.settings = settings;
  }

  private getActiveOpenCodeLeaf(): WorkspaceLeaf | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view.getViewType() === OPENCODE_VIEW_TYPE) {
      return activeLeaf;
    }
    return null;
  }

  async activateView(): Promise<void> {
    const existingLeaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);

    // Create new leaf based on defaultViewLocation setting
    let leaf: WorkspaceLeaf | null = null;
    const useSidebar =
      this.settings.defaultViewLocation === "sidebar" &&
      existingLeaves.length === 0;

    if (!useSidebar) {
      leaf = this.app.workspace.getLeaf("tab");
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
    }

    if (leaf) {
      await leaf.setViewState({
        type: OPENCODE_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async toggleView(): Promise<void> {
    const activeLeaf = this.getActiveOpenCodeLeaf();

    if (activeLeaf) {
      activeLeaf.detach();
      return;
    }

    await this.activateView();
  }

  async ensureSessionUrl(view: OpenCodeView): Promise<void> {
    if (this.getServerState() !== "running") {
      return;
    }

    const trackedUrl = view.getTrackedSessionUrl();
    const trackedSessionId = trackedUrl
      ? this.client.resolveSessionId(trackedUrl)
      : null;
    if (trackedUrl && trackedSessionId) {
      view.setIframeUrl(trackedUrl);
      this.registerSessionForView(view.getViewId(), view.getLeaf(), trackedSessionId);
      return;
    }

    const sessionId = await this.client.createSession();
    if (!sessionId) {
      return;
    }

    const sessionUrl = this.client.getSessionUrl(sessionId);
    view.setIframeUrl(sessionUrl);
    this.registerSessionForView(view.getViewId(), view.getLeaf(), sessionId);

    if (this.app.workspace.activeLeaf === view.getLeaf()) {
      await this.contextManager.refreshContextForView(view);
    }
  }
}
