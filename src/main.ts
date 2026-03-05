import { Plugin, Notice, WorkspaceLeaf } from "obsidian";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import {
  OpenCodeSettings,
  DEFAULT_SETTINGS,
  OPENCODE_VIEW_TYPE,
  OpenCodeSessionTab,
} from "./types";
import { OpenCodeView } from "./ui/OpenCodeView";
import { ViewManager } from "./ui/ViewManager";
import { OpenCodeSettingTab } from "./settings/SettingsTab";
import { ServerManager, ServerState } from "./server/ServerManager";
import { registerOpenCodeIcons, OPENCODE_ICON_NAME } from "./icons";
import { OpenCodeClient } from "./client/OpenCodeClient";
import { ContextManager } from "./context/ContextManager";
import { ExecutableResolver } from "./server/ExecutableResolver";
import { SessionRegistry } from "./session/SessionRegistry";

export default class OpenCodePlugin extends Plugin {
  settings: OpenCodeSettings = DEFAULT_SETTINGS;
  private processManager: ServerManager;
  private stateChangeCallbacks: Array<(state: ServerState) => void> = [];
  private openCodeClient: OpenCodeClient;
  private contextManager: ContextManager;
  private viewManager: ViewManager;
  private sessionRegistry = new SessionRegistry<WorkspaceLeaf>();
  private sessionTabsCallbacks: Array<() => void> = [];

  async onload(): Promise<void> {
    console.log("Loading OpenCode plugin");

    registerOpenCodeIcons();

    await this.loadSettings();

    // Attempt autodetect if opencodePath is empty and not using custom command
    await this.attemptAutodetect();

    const projectDirectory = this.getProjectDirectory();

    this.processManager = new ServerManager(this.settings, projectDirectory);
    this.processManager.on("stateChange", (state: ServerState) => {
      this.notifyStateChange(state);
    });

    // Listen for project directory changes and coordinate response
    this.processManager.on("projectDirectoryChanged", async (newDirectory: string) => {
      this.settings.projectDirectory = newDirectory;
      await this.saveData(this.settings);
      this.refreshClientState();
      if (this.getServerState() === "running") {
        await this.stopServer();
        await this.startServer();
      }
    });

    this.openCodeClient = new OpenCodeClient(
      this.getApiBaseUrl(),
      this.getServerUrl(),
      projectDirectory
    );

    this.contextManager = new ContextManager({
      app: this.app,
      settings: this.settings,
      client: this.openCodeClient,
      getServerState: () => this.getServerState(),
      registerEvent: (ref) => this.registerEvent(ref),
    });

    this.viewManager = new ViewManager({
      app: this.app,
      settings: this.settings,
      client: this.openCodeClient,
      contextManager: this.contextManager,
      getServerState: () => this.getServerState(),
      registerSession: (sessionId, leaf) => {
        this.registerSession(sessionId, leaf);
      },
    });

    console.log(
      "[OpenCode] Configured with project directory:",
      projectDirectory
    );

    this.registerView(
      OPENCODE_VIEW_TYPE,
      (leaf) => new OpenCodeView(leaf, this)
    );
    this.addSettingTab(new OpenCodeSettingTab(
      this.app,
      this,
      this.settings,
      this.processManager,
      () => this.saveSettings()
    ));

    this.addRibbonIcon(OPENCODE_ICON_NAME, "OpenCode", () => {
      void this.openNewSessionView();
    });
    this.addRightRibbonIcon();

    this.addCommand({
      id: "toggle-opencode-view",
      name: "Toggle OpenCode panel",
      callback: () => {
        void this.viewManager.toggleView();
      },
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "o",
        },
      ],
    });

    this.addCommand({
      id: "open-new-opencode-session",
      name: "Open new OpenCode session",
      callback: () => {
        void this.openNewSessionView();
      },
    });

    this.addCommand({
      id: "start-opencode-server",
      name: "Start OpenCode server",
      callback: () => {
        this.startServer();
      },
    });

    this.addCommand({
      id: "stop-opencode-server",
      name: "Stop OpenCode server",
      callback: () => {
        this.stopServer();
      },
    });

    this.addCommand({
      id: "restart-opencode-server",
      name: "Restart OpenCode server (reload AGENTS.md/CLAUDE.md)",
      callback: () => {
        void this.restartServer();
      },
    });

    this.addCommand({
      id: "diagnose-opencode-rules",
      name: "Diagnose AGENTS.md/CLAUDE.md rule files",
      callback: () => {
        this.showRuleFileDiagnostics();
      },
    });

    if (this.settings.autoStart) {
      this.app.workspace.onLayoutReady(async () => {
        await this.startServer();
      });
    }

    this.contextManager.updateSettings(this.settings);
    this.processManager.on("stateChange", (state: ServerState) => {
      if (state === "running") {
        void this.contextManager.handleServerRunning();
      }
    });

    this.registerCleanupHandlers();

    console.log("OpenCode plugin loaded");
  }

  async onunload(): Promise<void> {
    this.contextManager.destroy();
    await this.stopServer();
    this.app.workspace.detachLeavesOfType(OPENCODE_VIEW_TYPE);
    this.sessionTabsCallbacks = [];
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Attempt to autodetect opencode executable on startup
   * Triggers when opencodePath is empty and useCustomCommand is false
   */
  private async attemptAutodetect(): Promise<void> {
    // Only autodetect if path is empty and not using custom command mode
    if (this.settings.opencodePath || this.settings.useCustomCommand) {
      return;
    }

    console.log("[OpenCode] Attempting to autodetect opencode executable...");

    const detectedPath = ExecutableResolver.resolve("opencode");
    
    // Check if a different path was found (not the fallback)
    if (detectedPath && detectedPath !== "opencode") {
      console.log("[OpenCode] Autodetected opencode at:", detectedPath);
      this.settings.opencodePath = detectedPath;
      await this.saveData(this.settings);
      new Notice(`OpenCode executable found at ${detectedPath}`);
    } else {
      console.log("[OpenCode] Could not autodetect opencode executable");
      new Notice("Could not find opencode. Please check Settings");
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.processManager.updateSettings(this.settings);
    this.refreshClientState();
    this.contextManager.updateSettings(this.settings);
    this.viewManager.updateSettings(this.settings);
  }

  async startServer(): Promise<boolean> {
    const previousState = this.getServerState();
    const success = await this.processManager.start();
    if (success) {
      if (previousState !== "running" && previousState !== "starting") {
        new Notice("OpenCode server started");
      }
    } else {
      const error = this.processManager.getLastError();
      if (error) {
        new Notice(`OpenCode failed to start: ${error}`, 10000); // Show for 10 seconds
      } else {
        new Notice("OpenCode failed to start. Check Settings for details.", 5000);
      }
    }
    return success;
  }

  async stopServer(): Promise<void> {
    await this.processManager.stop();
    new Notice("OpenCode server stopped");
  }

  async restartServer(): Promise<boolean> {
    const currentState = this.getServerState();
    const wasRunning = currentState === "running" || currentState === "starting";

    if (wasRunning) {
      await this.processManager.stop();
    }

    const success = await this.processManager.start();
    if (success) {
      const action = wasRunning ? "restarted" : "started";
      new Notice(`OpenCode server ${action}. AGENTS.md/CLAUDE.md rules reloaded.`);
    } else {
      const error = this.processManager.getLastError();
      if (error) {
        new Notice(`OpenCode failed to restart: ${error}`, 10000);
      } else {
        new Notice("OpenCode failed to restart. Check Settings for details.", 5000);
      }
    }

    return success;
  }

  private showRuleFileDiagnostics(): void {
    const projectDirectory = this.getProjectDirectory();
    if (!projectDirectory) {
      new Notice("Could not determine project directory. Check plugin settings.");
      return;
    }

    const localMatches: string[] = [];
    const seen = new Set<string>();
    let currentDir = resolve(projectDirectory);

    while (true) {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const candidate = join(currentDir, name);
        if (existsSync(candidate) && !seen.has(candidate)) {
          localMatches.push(candidate);
          seen.add(candidate);
        }
      }

      const parent = dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }

    const globalCandidates = [
      join(homedir(), ".config", "opencode", "AGENTS.md"),
      join(homedir(), ".claude", "CLAUDE.md"),
    ];
    const globalMatches = globalCandidates.filter((path) => existsSync(path));

    console.log("[OpenCode] Rule file diagnostics", {
      projectDirectory,
      localMatches,
      globalMatches,
    });

    const totalMatches = localMatches.length + globalMatches.length;
    if (totalMatches === 0) {
      new Notice("No AGENTS.md/CLAUDE.md files found from project directory upward.");
      return;
    }

    new Notice(`Found ${totalMatches} AGENTS.md/CLAUDE.md file(s). See developer console for details.`);
  }

  getServerState(): ServerState {
    return this.processManager.getState() ?? "stopped";
  }

  getLastError(): string | null {
    return this.processManager.getLastError() ?? null;
  }

  getServerUrl(): string {
    return this.processManager.getUrl();
  }

  getApiBaseUrl(): string {
    return `http://${this.settings.hostname}:${this.settings.port}`;
  }

  onServerStateChange(callback: (state: ServerState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  private notifyStateChange(state: ServerState): void {
    for (const callback of this.stateChangeCallbacks) {
      callback(state);
    }
  }

  private refreshClientState(): void {
    const nextUiBaseUrl = this.getServerUrl();
    const nextApiBaseUrl = this.getApiBaseUrl();
    const projectDirectory = this.getProjectDirectory();
    this.openCodeClient.updateBaseUrl(nextApiBaseUrl, nextUiBaseUrl, projectDirectory);
  }

  refreshContextForView(view: OpenCodeView): void {
    void this.contextManager.refreshContextForView(view);
  }

  async ensureSessionUrl(view: OpenCodeView): Promise<void> {
    await this.viewManager.ensureSessionUrl(view);
  }

  registerSession(sessionId: string, leaf: WorkspaceLeaf): void {
    const changed = this.sessionRegistry.register(sessionId, leaf);
    if (changed) {
      this.notifySessionTabsChange();
    }
  }

  unregisterLeafSessions(leaf: WorkspaceLeaf): void {
    const changed = this.sessionRegistry.unregisterSessionsForLeaf(leaf);
    if (changed) {
      this.notifySessionTabsChange();
    }
  }

  getSessionTabs(activeSessionId?: string): OpenCodeSessionTab[] {
    this.pruneStaleSessionLeaves();
    return this.sessionRegistry.getTabs(activeSessionId);
  }

  async activateSession(sessionId: string): Promise<void> {
    this.pruneStaleSessionLeaves();
    const leaf = this.sessionRegistry.resolveLeaf(sessionId);
    if (!leaf) {
      return;
    }

    const sessionUrl = this.openCodeClient.getSessionUrl(sessionId);
    const view = leaf.view instanceof OpenCodeView ? leaf.view : null;
    if (view) {
      view.setIframeUrl(sessionUrl);
    }

    this.app.workspace.revealLeaf(leaf);
    if (view) {
      await this.contextManager.refreshContextForView(view);
    }
    this.notifySessionTabsChange();
  }

  async openNewSessionView(): Promise<void> {
    await this.viewManager.openNewSession();
  }

  async closeSession(sessionId: string, currentSessionId?: string): Promise<void> {
    this.pruneStaleSessionLeaves();

    const tabsBefore = this.sessionRegistry.getTabs(currentSessionId);
    const closedIndex = tabsBefore.findIndex((tab) => tab.sessionId === sessionId);
    if (closedIndex < 0) {
      return;
    }

    const wasCurrentSession = currentSessionId === sessionId;
    const changed = this.sessionRegistry.unregisterSession(sessionId);
    if (!changed) {
      return;
    }

    const tabsAfter = this.sessionRegistry.getTabs(
      wasCurrentSession ? undefined : currentSessionId
    );

    if (tabsAfter.length === 0) {
      this.notifySessionTabsChange();
      await this.openNewSessionView();
      return;
    }

    if (!wasCurrentSession) {
      this.notifySessionTabsChange();
      return;
    }

    const nextIndex = Math.min(closedIndex, tabsAfter.length - 1);
    const fallbackSession = tabsAfter[nextIndex];
    if (!fallbackSession) {
      this.notifySessionTabsChange();
      return;
    }

    await this.activateSession(fallbackSession.sessionId);
  }

  onSessionTabsChange(callback: () => void): () => void {
    this.sessionTabsCallbacks.push(callback);
    return () => {
      const index = this.sessionTabsCallbacks.indexOf(callback);
      if (index > -1) {
        this.sessionTabsCallbacks.splice(index, 1);
      }
    };
  }

  getProjectDirectory(): string {
    if (this.settings.projectDirectory) {
      console.log("[OpenCode] Using project directory from settings:", this.settings.projectDirectory);
      return this.settings.projectDirectory;
    }
    const adapter = this.app.vault.adapter as any;
    const vaultPath = adapter.basePath || "";
    if (!vaultPath) {
      console.warn("[OpenCode] Warning: Could not determine vault path");
    }
    console.log("[OpenCode] Using vault path as project directory:", vaultPath);
    return vaultPath;
  }

  private registerCleanupHandlers(): void {
    this.registerEvent(
      this.app.workspace.on("quit", () => {
        console.log("[OpenCode] Obsidian quitting - performing sync cleanup");
        this.stopServer();
      })
    );
  }

  private pruneStaleSessionLeaves(): void {
    const openLeaves = new Set(this.app.workspace.getLeavesOfType(OPENCODE_VIEW_TYPE));
    const changed = this.sessionRegistry.prune((leaf) => openLeaves.has(leaf));
    if (changed) {
      this.notifySessionTabsChange();
    }
  }

  private notifySessionTabsChange(): void {
    for (const callback of this.sessionTabsCallbacks) {
      callback();
    }
  }

  private addRightRibbonIcon(): void {
    const rightRibbon = (this.app.workspace as any).rightRibbon;
    const addAction = rightRibbon?.addAction as
      | ((icon: string, title: string, callback: (evt: MouseEvent) => any) => HTMLElement)
      | undefined;

    if (!addAction) {
      console.warn("[OpenCode] Right ribbon is not available in this Obsidian build");
      return;
    }

    const iconEl = addAction.call(
      rightRibbon,
      OPENCODE_ICON_NAME,
      "OpenCode",
      () => {
        void this.openNewSessionView();
      }
    );

    this.register(() => {
      iconEl.remove();
    });
  }
}
