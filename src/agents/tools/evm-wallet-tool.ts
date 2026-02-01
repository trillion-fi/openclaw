import { Type } from "@sinclair/typebox";

import type { OpenClawConfig } from "../../config/config.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const EVM_WALLET_ACTIONS = ["status", "signMessage"] as const;

// NOTE: Flattened schema (no union/anyOf) for broad provider compatibility.
const EvmWalletToolSchema = Type.Object({
  action: stringEnum(EVM_WALLET_ACTIONS),
  // signMessage
  message: Type.Optional(
    Type.String({ description: "Message to sign (EIP-191). Requires approval." }),
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

export function createEvmWalletTool(opts?: {
  agentSessionKey?: string;
  agentId?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "EVM Wallet",
    name: "evm_wallet",
    description:
      "Gateway-native EVM wallet. Can report status and request an approval-gated signature. Private keys never leave the gateway.",
    parameters: EvmWalletToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayUrl = readStringParam(params, "gatewayUrl") ?? undefined;
      const gatewayToken = readStringParam(params, "gatewayToken") ?? undefined;
      const timeoutMs = readNumberParam(params, "timeoutMs");

      if (action === "status") {
        const result = await callGatewayTool(
          "wallet.evm.status",
          { gatewayUrl, gatewayToken, timeoutMs },
          {},
        );
        return jsonResult({ ok: true, result });
      }

      if (action === "signMessage") {
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
          "wallet.evm.signMessage",
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
