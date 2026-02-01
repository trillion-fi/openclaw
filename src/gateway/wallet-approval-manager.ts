import { randomUUID } from "node:crypto";

export type WalletApprovalDecision = "approve" | "deny";

export type WalletApprovalKind = "evm.signMessage" | "solana.signMessage";

export type WalletApprovalRequestPayload = {
  kind: WalletApprovalKind;
  from: string;
  messageHash?: string | null;
  messagePreview?: string | null;
  messageSize?: number | null;
  agentId?: string | null;
  sessionKey?: string | null;
};

export type WalletApprovalRecord = {
  id: string;
  request: WalletApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: WalletApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: WalletApprovalRecord;
  resolve: (decision: WalletApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WalletApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    request: WalletApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): WalletApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : `wallet_${randomUUID()}`;
    const record: WalletApprovalRecord = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
    return record;
  }

  async waitForDecision(
    record: WalletApprovalRecord,
    timeoutMs: number,
  ): Promise<WalletApprovalDecision | null> {
    return await new Promise<WalletApprovalDecision | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(record.id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(record.id, { record, resolve, reject, timer });
    });
  }

  resolve(recordId: string, decision: WalletApprovalDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    this.pending.delete(recordId);
    pending.resolve(decision);
    return true;
  }

  getSnapshot(recordId: string): WalletApprovalRecord | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }
}
