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
  registerSession: (sessionId: string, leaf: WorkspaceLeaf) => void;
};

export class ViewManager {
  private app: App;
  private settings: OpenCodeSettings;
  private client: OpenCodeClient;
  private contextManager: ContextManager;
  private getServerState: () => ServerState;
  private registerSession: (sessionId: string, leaf: WorkspaceLeaf) => void;

  constructor(deps: ViewManagerDeps) {
    this.app = deps.app;
    this.settings = deps.settings;
    this.client = deps.client;
    this.contextManager = deps.contextManager;
    this.getServerState = deps.getServerState;
    this.registerSession = deps.registerSession;
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

  private getExistingSidebarLeaf(): WorkspaceLeaf | null {
    const rightSplit = this.app.workspace.rightSplit;
    if (!rightSplit) {
      return null;
    }

    const leaves = this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE);
    return leaves.find((leaf) => leaf.getRoot() === rightSplit) ?? null;
  }

  async activateView(): Promise<void> {
    // Create new leaf based on defaultViewLocation setting
    let leaf: WorkspaceLeaf | null = null;
    const useSidebar = this.settings.defaultViewLocation === "sidebar";

    if (useSidebar) {
      leaf = this.getExistingSidebarLeaf();

      const rightSplit = this.app.workspace.rightSplit as { collapsed?: boolean; toggle?: () => void } | null;
      if (rightSplit && rightSplit.collapsed && typeof rightSplit.toggle === "function") {
        rightSplit.toggle();
      }

      if (!leaf) {
        leaf = this.app.workspace.getRightLeaf(true);
      }
    } else {
      leaf = this.app.workspace.getLeaf("tab");
    }

    if (leaf) {
      await leaf.setViewState({
        type: OPENCODE_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async openNewSession(): Promise<void> {
    if (this.settings.defaultViewLocation !== "sidebar") {
      await this.activateView();
      return;
    }

    await this.activateView();
    const leaf = this.getExistingSidebarLeaf();
    const view = leaf?.view instanceof OpenCodeView ? leaf.view : null;
    if (!view || this.getServerState() !== "running") {
      return;
    }

    await this.createAndActivateSession(view);
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
      this.registerSession(trackedSessionId, view.getLeaf());
      return;
    }

    await this.createAndActivateSession(view);
  }

  private async createAndActivateSession(view: OpenCodeView): Promise<void> {
    const sessionId = await this.client.createSession();
    if (!sessionId) {
      return;
    }

    const sessionUrl = this.client.getSessionUrl(sessionId);
    view.setIframeUrl(sessionUrl);
    this.registerSession(sessionId, view.getLeaf());
    await this.contextManager.refreshContextForView(view);
  }
}
