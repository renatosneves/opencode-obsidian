import { OpenCodeSessionTab } from "../types";

type SessionBinding<TLeaf> = {
  viewId: string;
  sessionId: string;
  leaf: TLeaf;
};

export class SessionRegistry<TLeaf> {
  private viewBindings = new Map<string, SessionBinding<TLeaf>>();
  private sessionToView = new Map<string, string>();
  private sessionOrder: string[] = [];

  register(viewId: string, leaf: TLeaf, sessionId: string): boolean {
    let changed = false;

    const existingBindingForView = this.viewBindings.get(viewId);
    if (
      existingBindingForView &&
      existingBindingForView.sessionId !== sessionId &&
      this.sessionToView.get(existingBindingForView.sessionId) === viewId
    ) {
      this.sessionToView.delete(existingBindingForView.sessionId);
      this.removeSessionFromOrder(existingBindingForView.sessionId);
      changed = true;
    }

    const existingViewForSession = this.sessionToView.get(sessionId);
    if (existingViewForSession && existingViewForSession !== viewId) {
      this.viewBindings.delete(existingViewForSession);
      changed = true;
    }

    if (!this.sessionOrder.includes(sessionId)) {
      this.sessionOrder.push(sessionId);
      changed = true;
    }

    const nextBinding: SessionBinding<TLeaf> = {
      viewId,
      sessionId,
      leaf,
    };

    if (
      !existingBindingForView ||
      existingBindingForView.sessionId !== sessionId ||
      existingBindingForView.leaf !== leaf
    ) {
      changed = true;
    }

    this.viewBindings.set(viewId, nextBinding);
    this.sessionToView.set(sessionId, viewId);

    return changed;
  }

  unregisterView(viewId: string): boolean {
    const binding = this.viewBindings.get(viewId);
    if (!binding) {
      return false;
    }

    this.viewBindings.delete(viewId);
    if (this.sessionToView.get(binding.sessionId) === viewId) {
      this.sessionToView.delete(binding.sessionId);
    }
    this.removeSessionFromOrder(binding.sessionId);
    return true;
  }

  prune(isLeafValid: (leaf: TLeaf) => boolean): boolean {
    const removedViewIds: string[] = [];

    for (const [viewId, binding] of this.viewBindings.entries()) {
      if (!isLeafValid(binding.leaf)) {
        removedViewIds.push(viewId);
      }
    }

    if (removedViewIds.length === 0) {
      return false;
    }

    for (const viewId of removedViewIds) {
      this.unregisterView(viewId);
    }

    return true;
  }

  resolveLeaf(sessionId: string): TLeaf | null {
    const viewId = this.sessionToView.get(sessionId);
    if (!viewId) {
      return null;
    }
    return this.viewBindings.get(viewId)?.leaf ?? null;
  }

  getTabs(activeSessionId?: string): OpenCodeSessionTab[] {
    this.normalizeSessionOrder();

    let labelNumber = 1;
    const tabs: OpenCodeSessionTab[] = [];

    for (const sessionId of this.sessionOrder) {
      tabs.push({
        sessionId,
        label: `Session ${labelNumber++}`,
        isActive: sessionId === activeSessionId,
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
      const mappedViewId = this.sessionToView.get(sessionId);
      if (!mappedViewId) {
        continue;
      }
      const binding = this.viewBindings.get(mappedViewId);
      if (!binding || binding.sessionId !== sessionId) {
        continue;
      }

      seen.add(sessionId);
      deduped.push(sessionId);
    }

    this.sessionOrder = deduped;
  }
}
