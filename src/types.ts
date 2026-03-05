export type ViewLocation = "sidebar" | "main";

export interface OpenCodeSettings {
  port: number;
  hostname: string;
  autoStart: boolean;
  opencodePath: string;
  projectDirectory: string;
  startupTimeout: number;
  defaultViewLocation: ViewLocation;
  injectWorkspaceContext: boolean;
  maxNotesInContext: number;
  maxSelectionLength: number;
  customCommand: string;
  useCustomCommand: boolean;
}

export interface OpenCodeSessionTab {
  sessionId: string;
  label: string;
  isActive: boolean;
}

export const DEFAULT_SETTINGS: OpenCodeSettings = {
  port: 14096,
  hostname: "127.0.0.1",
  autoStart: false,
  opencodePath: "opencode",
  projectDirectory: "",
  startupTimeout: 45000,
  defaultViewLocation: "sidebar",
  injectWorkspaceContext: false,
  maxNotesInContext: 20,
  maxSelectionLength: 2000,
  customCommand: "",
  useCustomCommand: false,
};

export const OPENCODE_PLUGIN_ID = "opencode-obsidian-neves";
export const OPENCODE_VIEW_TYPE = "opencode-view-neves";
