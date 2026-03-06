type OpenCodePart = {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
  text?: string;
  ignored?: boolean;
  synthetic?: boolean;
  metadata?: Record<string, unknown>;
  time?: {
    start: number;
    end?: number;
  };
};

type OpenCodeMessageInfo = {
  id: string;
  sessionID: string;
  role?: string;
  time?: {
    created?: number;
    completed?: number;
  };
};

type OpenCodeMessageWithParts = {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
};

type OpenCodeSession = {
  id?: string;
};

type OpenCodeResponse<T> = T | { data?: T } | { message?: T } | null;

export class OpenCodeClient {
  private apiBaseUrl: string;
  private uiBaseUrl: string;
  private projectDirectory: string;
  private sessionParts = new Map<string, OpenCodePart | null>();

  constructor(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string) {
    this.apiBaseUrl = this.normalizeBaseUrl(apiBaseUrl);
    this.uiBaseUrl = this.normalizeBaseUrl(uiBaseUrl);
    this.projectDirectory = projectDirectory;
  }

  updateBaseUrl(apiBaseUrl: string, uiBaseUrl: string, projectDirectory: string): void {
    const nextApiUrl = this.normalizeBaseUrl(apiBaseUrl);
    const nextUiUrl = this.normalizeBaseUrl(uiBaseUrl);
    if (
      nextApiUrl !== this.apiBaseUrl ||
      nextUiUrl !== this.uiBaseUrl ||
      projectDirectory !== this.projectDirectory
    ) {
      this.apiBaseUrl = nextApiUrl;
      this.uiBaseUrl = nextUiUrl;
      this.projectDirectory = projectDirectory;
      this.resetTracking();
    }
  }

  resetTracking(): void {
    this.sessionParts.clear();
  }

  getSessionUrl(sessionId: string): string {
    return `${this.uiBaseUrl}/session/${sessionId}`;
  }

  resolveSessionId(iframeUrl: string): string | null {
    const match = iframeUrl.match(/\/session\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  async createSession(): Promise<string | null> {
    const result = await this.request<OpenCodeSession>("POST", "/session", {
      title: "Obsidian",
    });
    const session = this.unwrap(result);
    return session?.id ?? null;
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const result = await this.request<boolean>("POST", `/session/${sessionId}/abort`);
    return this.unwrap(result) === true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.request<boolean>("DELETE", `/session/${sessionId}`);
    return this.unwrap(result) === true;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const aborted = await this.abortSession(sessionId);
    if (!aborted) {
      console.warn("[OpenCode] Failed to abort session before delete", { sessionId });
    }

    const deleted = await this.deleteSession(sessionId);
    if (deleted) {
      this.sessionParts.delete(sessionId);
    }
    return deleted;
  }

  async isSessionRunning(sessionId: string): Promise<boolean | null> {
    const result = await this.request<OpenCodeMessageWithParts[]>(
      "GET",
      `/session/${sessionId}/message`
    );
    const messages = this.unwrap(result);
    if (!messages) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.info?.role !== "assistant") {
        continue;
      }

      const completed = message.info.time?.completed;
      return !completed;
    }

    return false;
  }

  async updateContext(params: {
    sessionId: string;
    contextText: string | null;
  }): Promise<void> {
    const { sessionId, contextText } = params;

    if (!contextText) {
      await this.ignorePreviousPart(sessionId);
      return;
    }

    const lastPart = this.sessionParts.get(sessionId) ?? null;
    if (lastPart) {
      const updated = await this.updatePart(lastPart, { text: contextText });
      if (updated) {
        this.sessionParts.set(sessionId, updated);
        return;
      }
      await this.ignorePreviousPart(sessionId);
    }

    const message = await this.sendPrompt(sessionId, contextText);
    this.sessionParts.set(sessionId, message?.parts?.[0] ?? null);
  }

  private async sendPrompt(sessionId: string, contextText: string): Promise<OpenCodeMessageWithParts | null> {
    const result = await this.request<OpenCodeMessageWithParts>(
      "POST",
      `/session/${sessionId}/message`,
      {
        noReply: true,
        parts: [{ type: "text", text: contextText }],
      }
    );

    console.log("[OpenCode] Injected context message");
    console.log(contextText)

    const message = this.unwrap(result);
    if (!message) {
      console.error("[OpenCode] Failed to inject context message");
    }
    return message;
  }

  private async updatePart(
    part: OpenCodePart,
    updates: { text?: string; ignored?: boolean }
  ): Promise<OpenCodePart | null> {
    const result = await this.request<OpenCodePart>(
      "PATCH",
      `/session/${part.sessionID}/message/${part.messageID}/part/${part.id}`,
      {
        ...part,
        ...updates,
      }
    );
    return this.unwrap(result);
  }

  private async ignorePreviousPart(sessionId: string): Promise<boolean> {
    const part = this.sessionParts.get(sessionId) ?? null;
    if (!part) {
      return false;
    }

    const ignored = await this.updatePart(part, { ignored: true });
    if (!ignored) {
      return false;
    }

    this.sessionParts.set(sessionId, null);
    return true;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<OpenCodeResponse<T>> {
    try {
      const url = `${this.apiBaseUrl}${path}`;
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": this.projectDirectory,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        console.error("[OpenCode] API request failed", {
          path,
          status: response.status,
        });
        return null;
      }

      const json = await response
        .json()
        .catch(() => null);
      return json as OpenCodeResponse<T>;
    } catch (error) {
      console.error("[OpenCode] API request error", error);
      return null;
    }
  }

  private unwrap<T>(result: OpenCodeResponse<T>): T | null {
    if (!result) {
      return null;
    }
    if (typeof result === "object") {
      const payload = result as { data?: T; message?: T };
      if (payload.data) {
        return payload.data;
      }
      if (payload.message) {
        return payload.message;
      }
    }
    return result as T;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
  }
}
