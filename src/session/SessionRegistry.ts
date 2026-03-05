import { OpenCodeSessionTab } from "../types";

type SessionBinding<TLeaf> = {
  sessionId: string;
  leaf: TLeaf;
  isRunning: boolean;
};

export class SessionRegistry<TLeaf> {
  private sessionBindings = new Map<string, SessionBinding<TLeaf>>();
  private sessionOrder: string[] = [];

  register(sessionId: string, leaf: TLeaf): boolean {
    let changed = false;

    const existing = this.sessionBindings.get(sessionId);
    if (!existing || existing.leaf !== leaf) {
      changed = true;
    }

    if (!this.sessionOrder.includes(sessionId)) {
      this.sessionOrder.push(sessionId);
      changed = true;
    }

    const nextBinding: SessionBinding<TLeaf> = {
      sessionId,
      leaf,
      isRunning: existing?.isRunning ?? false,
    };

    this.sessionBindings.set(sessionId, nextBinding);

    return changed;
  }

  unregisterSession(sessionId: string): boolean {
    const hadSession = this.sessionBindings.delete(sessionId);
    if (!hadSession) {
      return false;
    }

    this.removeSessionFromOrder(sessionId);
    return true;
  }

  unregisterSessionsForLeaf(leaf: TLeaf): boolean {
    const sessionsToRemove: string[] = [];
    for (const [sessionId, binding] of this.sessionBindings.entries()) {
      if (binding.leaf === leaf) {
        sessionsToRemove.push(sessionId);
      }
    }

    if (sessionsToRemove.length === 0) {
      return false;
    }

    for (const sessionId of sessionsToRemove) {
      this.sessionBindings.delete(sessionId);
      this.removeSessionFromOrder(sessionId);
    }

    return true;
  }

  prune(isLeafValid: (leaf: TLeaf) => boolean): boolean {
    const removedSessionIds: string[] = [];

    for (const [sessionId, binding] of this.sessionBindings.entries()) {
      if (!isLeafValid(binding.leaf)) {
        removedSessionIds.push(sessionId);
      }
    }

    if (removedSessionIds.length === 0) {
      return false;
    }

    for (const sessionId of removedSessionIds) {
      this.sessionBindings.delete(sessionId);
      this.removeSessionFromOrder(sessionId);
    }

    return true;
  }

  resolveLeaf(sessionId: string): TLeaf | null {
    return this.sessionBindings.get(sessionId)?.leaf ?? null;
  }

  setSessionRunning(sessionId: string, isRunning: boolean): boolean {
    const binding = this.sessionBindings.get(sessionId);
    if (!binding || binding.isRunning === isRunning) {
      return false;
    }

    this.sessionBindings.set(sessionId, {
      ...binding,
      isRunning,
    });
    return true;
  }

  clearRunningStates(): boolean {
    let changed = false;

    for (const [sessionId, binding] of this.sessionBindings.entries()) {
      if (!binding.isRunning) {
        continue;
      }
      this.sessionBindings.set(sessionId, {
        ...binding,
        isRunning: false,
      });
      changed = true;
    }

    return changed;
  }

  getSessionIds(): string[] {
    this.normalizeSessionOrder();
    return [...this.sessionOrder];
  }

  getTabs(activeSessionId?: string): OpenCodeSessionTab[] {
    this.normalizeSessionOrder();

    let labelNumber = 1;
    const tabs: OpenCodeSessionTab[] = [];

    for (const sessionId of this.sessionOrder) {
      const binding = this.sessionBindings.get(sessionId);
      if (!binding) {
        continue;
      }

      tabs.push({
        sessionId,
        label: `Session ${labelNumber++}`,
        isActive: sessionId === activeSessionId,
        isRunning: binding.isRunning,
      });
    }

    return tabs;
  }

  private removeSessionFromOrder(sessionId: string): void {
    const index = this.sessionOrder.indexOf(sessionId);
    if (index > -1) {
      this.sessionOrder.splice(index, 1);
    }
  }

  private normalizeSessionOrder(): void {
    const deduped: string[] = [];
    const seen = new Set<string>();

    for (const sessionId of this.sessionOrder) {
      if (seen.has(sessionId)) {
        continue;
      }
      const binding = this.sessionBindings.get(sessionId);
      if (!binding) {
        continue;
      }

      seen.add(sessionId);
      deduped.push(sessionId);
    }

    this.sessionOrder = deduped;
  }
}
