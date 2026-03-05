import { OpenCodeSessionTab } from "../types";

type SessionBinding<TLeaf> = {
  viewId: string;
  sessionId: string;
  leaf: TLeaf;
  labelNumber: number;
};

export class SessionRegistry<TLeaf> {
  private viewBindings = new Map<string, SessionBinding<TLeaf>>();
  private sessionToView = new Map<string, string>();
  private sessionLabelNumbers = new Map<string, number>();
  private nextLabelNumber = 1;

  register(viewId: string, leaf: TLeaf, sessionId: string): boolean {
    let changed = false;

    const existingBindingForView = this.viewBindings.get(viewId);
    if (
      existingBindingForView &&
      existingBindingForView.sessionId !== sessionId &&
      this.sessionToView.get(existingBindingForView.sessionId) === viewId
    ) {
      this.sessionToView.delete(existingBindingForView.sessionId);
      changed = true;
    }

    const existingViewForSession = this.sessionToView.get(sessionId);
    if (existingViewForSession && existingViewForSession !== viewId) {
      this.viewBindings.delete(existingViewForSession);
      changed = true;
    }

    if (!this.sessionLabelNumbers.has(sessionId)) {
      this.sessionLabelNumbers.set(sessionId, this.nextLabelNumber++);
      changed = true;
    }

    const labelNumber = this.sessionLabelNumbers.get(sessionId) ?? 0;
    const nextBinding: SessionBinding<TLeaf> = {
      viewId,
      sessionId,
      leaf,
      labelNumber,
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
    return Array.from(this.viewBindings.values())
      .sort((a, b) => a.labelNumber - b.labelNumber)
      .map((binding) => ({
        sessionId: binding.sessionId,
        label: `Session ${binding.labelNumber}`,
        isActive: binding.sessionId === activeSessionId,
      }));
  }
}
