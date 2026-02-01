export type WalletApprovalRequestPayload = {
  kind: string;
  from: string;
  messageHash?: string | null;
  messagePreview?: string | null;
  messageSize?: number | null;
  agentId?: string | null;
  sessionKey?: string | null;
};

export type WalletApprovalRequest = {
  id: string;
  request: WalletApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type WalletApprovalResolved = {
  id: string;
  decision?: string | null;
  resolvedBy?: string | null;
  ts?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseWalletApprovalRequested(payload: unknown): WalletApprovalRequest | null {
  if (!isRecord(payload)) return null;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const request = payload.request;
  if (!id || !isRecord(request)) return null;
  const kind = typeof request.kind === "string" ? request.kind.trim() : "";
  const from = typeof request.from === "string" ? request.from.trim() : "";
  if (!kind || !from) return null;
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) return null;
  return {
    id,
    request: {
      kind,
      from,
      messageHash: typeof request.messageHash === "string" ? request.messageHash : null,
      messagePreview: typeof request.messagePreview === "string" ? request.messagePreview : null,
      messageSize: typeof request.messageSize === "number" ? request.messageSize : null,
      agentId: typeof request.agentId === "string" ? request.agentId : null,
      sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
    },
    createdAtMs,
    expiresAtMs,
  };
}

export function parseWalletApprovalResolved(payload: unknown): WalletApprovalResolved | null {
  if (!isRecord(payload)) return null;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;
  return {
    id,
    decision: typeof payload.decision === "string" ? payload.decision : null,
    resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
    ts: typeof payload.ts === "number" ? payload.ts : null,
  };
}

export function pruneWalletApprovalQueue(queue: WalletApprovalRequest[]): WalletApprovalRequest[] {
  const now = Date.now();
  return queue.filter((entry) => entry.expiresAtMs > now);
}

export function addWalletApproval(
  queue: WalletApprovalRequest[],
  entry: WalletApprovalRequest,
): WalletApprovalRequest[] {
  const next = pruneWalletApprovalQueue(queue).filter((item) => item.id !== entry.id);
  next.push(entry);
  return next;
}

export function removeWalletApproval(
  queue: WalletApprovalRequest[],
  id: string,
): WalletApprovalRequest[] {
  return pruneWalletApprovalQueue(queue).filter((entry) => entry.id !== id);
}

