import { hashMessage, Transaction } from "ethers";
import type { TransactionRequest } from "ethers";

import type { WalletApprovalForwarder } from "../../infra/wallet-approval-forwarder.js";
import type { EvmWalletService } from "../../wallet/evm-wallet-service.js";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNullish(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function buildTransactionPreview(tx: Transaction): string | null {
  const parts: string[] = [];
  if (tx.chainId != null) {
    parts.push(`chainId=${tx.chainId.toString()}`);
  }
  if (tx.to) {
    parts.push(`to=${tx.to}`);
  } else if (tx.data && tx.data !== "0x") {
    parts.push("to=<contract creation>");
  }
  if (tx.value != null) {
    parts.push(`valueWei=${tx.value.toString()}`);
  }
  if (tx.nonce != null) {
    parts.push(`nonce=${tx.nonce}`);
  }
  if (tx.gasLimit != null) {
    parts.push(`gasLimit=${tx.gasLimit.toString()}`);
  }
  if (tx.gasPrice != null) {
    parts.push(`gasPriceWei=${tx.gasPrice.toString()}`);
  } else if (tx.maxFeePerGas != null || tx.maxPriorityFeePerGas != null) {
    if (tx.maxFeePerGas != null) {
      parts.push(`maxFeePerGasWei=${tx.maxFeePerGas.toString()}`);
    }
    if (tx.maxPriorityFeePerGas != null) {
      parts.push(`maxPriorityFeePerGasWei=${tx.maxPriorityFeePerGas.toString()}`);
    }
  }
  const data = tx.data ?? "0x";
  if (data !== "0x") {
    const bytes = Math.max(0, Math.floor((data.length - 2) / 2));
    const selector = data.length >= 10 ? data.slice(0, 10) : data;
    parts.push(`data=${selector}…(${bytes} bytes)`);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" ");
}

export function createWalletEvmHandlers(
  wallet: EvmWalletService,
  opts?: { approvals?: WalletApprovalManager; forwarder?: WalletApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "wallet.evm.status": ({ respond }) => {
      respond(true, wallet.status(), undefined);
    },
    "wallet.evm.init": ({ params, respond }) => {
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
    "wallet.evm.unlock": ({ params, respond }) => {
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
    "wallet.evm.lock": ({ respond }) => {
      wallet.lock();
      respond(true, { ok: true }, undefined);
    },
    "wallet.evm.signMessage": async ({ params, respond, context }) => {
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
      const messageHash = hashMessage(message);
      const record = opts.approvals.create(
        {
          kind: "evm.signMessage",
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
        const signature = await wallet.signMessage({ message });
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
    "wallet.evm.signTransaction": async ({ params, respond, context }) => {
      const rawTx = params.tx;
      if (!isRecord(rawTx)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tx object required"));
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
      if (!isNonNullish(rawTx.chainId)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tx.chainId required"));
        return;
      }
      if (!isNonNullish(rawTx.nonce)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tx.nonce required"));
        return;
      }
      if (!isNonNullish(rawTx.gasLimit)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tx.gasLimit required"));
        return;
      }
      if (
        !isNonNullish(rawTx.gasPrice) &&
        !isNonNullish(rawTx.maxFeePerGas) &&
        !isNonNullish(rawTx.maxPriorityFeePerGas)
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "tx gas fee required (gasPrice or maxFeePerGas/maxPriorityFeePerGas)",
          ),
        );
        return;
      }
      let tx: Transaction;
      try {
        tx = Transaction.from(rawTx as unknown as TransactionRequest);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
      if (!tx.chainId || tx.chainId <= 0n) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid tx.chainId"));
        return;
      }
      const unsignedHash = tx.unsignedHash;
      const record = opts.approvals.create(
        {
          kind: "evm.signTransaction",
          from,
          messageHash: unsignedHash,
          messagePreview: buildMessagePreview(buildTransactionPreview(tx) ?? "evm tx"),
          messageSize: JSON.stringify(rawTx).length,
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
            unsignedHash,
          },
          undefined,
        );
        return;
      }
      try {
        const signedTransaction = await wallet.signTransaction(rawTx as unknown as TransactionRequest);
        const txHash = Transaction.from(signedTransaction).hash;
        respond(
          true,
          {
            id: record.id,
            decision,
            address: from,
            unsignedHash,
            txHash,
            signedTransaction,
          },
          undefined,
        );
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      }
    },
  };
}
