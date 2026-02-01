import { Type } from "@sinclair/typebox";

import type { OpenClawConfig } from "../../config/config.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const WALLET_ACTIONS = ["status", "signMessage"] as const;
const WALLET_CHAINS = ["evm", "solana"] as const;

function resolveGatewayMethod(chain: string, action: string): string {
  const normalizedChain = chain.trim().toLowerCase();
  const normalizedAction = action.trim();
  if (normalizedChain === "evm") {
    if (normalizedAction === "status") return "wallet.evm.status";
    if (normalizedAction === "signMessage") return "wallet.evm.signMessage";
  }
  if (normalizedChain === "solana") {
    if (normalizedAction === "status") return "wallet.solana.status";
    if (normalizedAction === "signMessage") return "wallet.solana.signMessage";
  }
  throw new Error(`Unknown chain/action: ${chain}/${action}`);
}

// NOTE: Flattened schema (no union/anyOf) for broad provider compatibility.
const WalletToolSchema = Type.Object({
  action: stringEnum(WALLET_ACTIONS),
  chain: Type.Optional(
    stringEnum(WALLET_CHAINS, {
      description: "Wallet chain: evm | solana. Required for signMessage.",
    }),
  ),
  // signMessage
  message: Type.Optional(
    Type.String({ description: "Message to sign. Requires approval (operator decision)." }),
  ),
  approvalTimeoutMs: Type.Optional(
    Type.Number({
      description: "Approval timeout in milliseconds (default ~120s).",
    }),
  ),
  // routing / session context (recommended for chat forwarding)
  sessionKey: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  // gateway connection overrides
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(
    Type.Number({ description: "Gateway RPC timeout (must exceed approvalTimeoutMs)." }),
  ),
});

export function createWalletTool(opts?: {
  agentSessionKey?: string;
  agentId?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Wallet",
    name: "wallet",
    description:
      "Gateway-native wallet (EVM + Solana). Can report status and request an approval-gated signature. Private keys never leave the gateway.",
    parameters: WalletToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const chain = readStringParam(params, "chain");
      const gatewayUrl = readStringParam(params, "gatewayUrl") ?? undefined;
      const gatewayToken = readStringParam(params, "gatewayToken") ?? undefined;
      const timeoutMs = readNumberParam(params, "timeoutMs");

      if (action === "status") {
        if (chain) {
          const method = resolveGatewayMethod(chain, action);
          const result = await callGatewayTool(method, { gatewayUrl, gatewayToken, timeoutMs }, {});
          return jsonResult({ ok: true, result });
        }
        const [evm, solana] = await Promise.all([
          callGatewayTool("wallet.evm.status", { gatewayUrl, gatewayToken, timeoutMs }, {}),
          callGatewayTool("wallet.solana.status", { gatewayUrl, gatewayToken, timeoutMs }, {}),
        ]);
        return jsonResult({ ok: true, result: { evm, solana } });
      }

      if (action === "signMessage") {
        if (!chain) {
          throw new Error("chain is required for action=signMessage");
        }
        const method = resolveGatewayMethod(chain, action);
        const message = readStringParam(params, "message", { required: true });
        const approvalTimeoutMs = readNumberParam(params, "approvalTimeoutMs") ?? 120_000;
        const fallbackSessionKey = opts?.agentSessionKey?.trim();
        const sessionKey =
          readStringParam(params, "sessionKey") ??
          (fallbackSessionKey ? fallbackSessionKey : undefined);
        const fallbackAgentId = opts?.agentId?.trim();
        const agentId =
          readStringParam(params, "agentId") ?? (fallbackAgentId ? fallbackAgentId : undefined);

        const gatewayTimeoutResolved =
          timeoutMs ?? Math.max(30_000, Math.floor(approvalTimeoutMs) + 15_000);

        const result = await callGatewayTool(
          method,
          { gatewayUrl, gatewayToken, timeoutMs: gatewayTimeoutResolved },
          {
            message,
            sessionKey,
            agentId,
            timeoutMs: approvalTimeoutMs,
          },
          { expectFinal: true },
        );
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}

