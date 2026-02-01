import type { WalletApprovalForwarder } from "../../infra/wallet-approval-forwarder.js";
import type { WalletApprovalDecision } from "../wallet-approval-manager.js";
import type { WalletApprovalManager } from "../wallet-approval-manager.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function normalizeDecision(value: unknown): WalletApprovalDecision | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "approve") {
    return "approve";
  }
  if (trimmed === "deny") {
    return "deny";
  }
  return null;
}

export function createWalletApprovalHandlers(
  manager: WalletApprovalManager,
  opts?: { forwarder?: WalletApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "wallet.approval.resolve": async ({ params, respond, client, context }) => {
      const id = typeof params.id === "string" ? params.id.trim() : "";
      const decision = normalizeDecision(params.decision);
      if (!id || !decision) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid params"));
        return;
      }
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = manager.resolve(id, decision, resolvedBy ?? null);
      if (!ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"));
        return;
      }
      context.broadcast(
        "wallet.approval.resolved",
        { id, decision, resolvedBy, ts: Date.now() },
        { dropIfSlow: true },
      );
      void opts?.forwarder
        ?.handleResolved({ id, decision, resolvedBy, ts: Date.now() })
        .catch((err) => {
          context.logGateway?.error?.(`wallet approvals: forward resolve failed: ${String(err)}`);
        });
      respond(true, { ok: true }, undefined);
    },
  };
}
