import crypto from "node:crypto";

import type { WalletApprovalForwarder } from "../../infra/wallet-approval-forwarder.js";
import type { SolanaWalletService } from "../../wallet/solana-wallet-service.js";
import type { WalletApprovalManager } from "../wallet-approval-manager.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const raw = params[key];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function readPassword(params: Record<string, unknown>): string | null {
  return readStringParam(params, "password");
}

function readTtlMs(params: Record<string, unknown>): number | undefined {
  const raw = params.ttlMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return Math.max(1_000, Math.floor(raw));
}

function readApprovalTimeoutMs(params: Record<string, unknown>): number {
  const raw = params.timeoutMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_APPROVAL_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.floor(raw));
}

function buildMessagePreview(message: string): string | null {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  const limit = 200;
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

function sha256Hex(message: string): string {
  const digest = crypto.createHash("sha256").update(Buffer.from(message, "utf8")).digest("hex");
  return `sha256:${digest}`;
}

export function createWalletSolanaHandlers(
  wallet: SolanaWalletService,
  opts?: { approvals?: WalletApprovalManager; forwarder?: WalletApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "wallet.solana.status": ({ respond }) => {
      respond(true, wallet.status(), undefined);
    },
    "wallet.solana.init": ({ params, respond }) => {
      const password = readPassword(params);
      if (!password) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "password required"));
        return;
      }
      try {
        const created = wallet.init({ password });
        respond(true, { ok: true, address: created.address }, undefined);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      }
    },
    "wallet.solana.unlock": ({ params, respond }) => {
      const password = readPassword(params);
      if (!password) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "password required"));
        return;
      }
      const ttlMs = readTtlMs(params);
      try {
        const unlocked = wallet.unlock({ password, ...(ttlMs ? { ttlMs } : {}) });
        respond(
          true,
          { ok: true, address: unlocked.address, unlockedUntilMs: unlocked.unlockedUntilMs },
          undefined,
        );
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      }
    },
    "wallet.solana.lock": ({ respond }) => {
      wallet.lock();
      respond(true, { ok: true }, undefined);
    },
    "wallet.solana.signMessage": async ({ params, respond, context }) => {
      const message = readStringParam(params, "message");
      if (!message) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "message required"));
        return;
      }
      if (!opts?.approvals) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "wallet approvals not configured"),
        );
        return;
      }
      const agentId = readStringParam(params, "agentId");
      const sessionKey = readStringParam(params, "sessionKey");
      const timeoutMs = readApprovalTimeoutMs(params);
      let from: string;
      try {
        from = wallet.requireUnlocked().address;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
      const messageHash = sha256Hex(message);
      const record = opts.approvals.create(
        {
          kind: "solana.signMessage",
          from,
          messageHash,
          messagePreview: buildMessagePreview(message),
          messageSize: message.length,
          agentId: agentId ?? null,
          sessionKey: sessionKey ?? null,
        },
        timeoutMs,
      );
      const decisionPromise = opts.approvals.waitForDecision(record, timeoutMs);
      context.broadcast(
        "wallet.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      void opts.forwarder
        ?.handleRequested({
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        })
        .catch((err) => {
          context.logGateway?.error?.(`wallet approvals: forward request failed: ${String(err)}`);
        });
      const decision = await decisionPromise;
      if (decision !== "approve") {
        respond(
          true,
          {
            id: record.id,
            decision,
            address: from,
            messageHash,
          },
          undefined,
        );
        return;
      }
      try {
        const signature = wallet.signMessage({ message });
        respond(
          true,
          {
            id: record.id,
            decision,
            address: from,
            messageHash,
            signature,
          },
          undefined,
        );
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      }
    },
  };
}

