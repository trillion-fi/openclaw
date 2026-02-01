import { callGateway } from "../../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

const WALLET_APPROVAL_ID_RE =
  /^wallet_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedWalletApproval =
  | { ok: true; id: string; decision: "approve" | "deny" }
  | { ok: false; error: string };

function parseWalletApproval(raw: string): ParsedWalletApproval | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(yes|no)\s+(\S+)\s*$/i);
  if (!match) {
    return null;
  }
  const decisionToken = match[1]?.toLowerCase();
  const idToken = match[2]?.trim() ?? "";
  if (!WALLET_APPROVAL_ID_RE.test(idToken)) {
    return { ok: false, error: "Unknown approval id format." };
  }
  return {
    ok: true,
    id: idToken,
    decision: decisionToken === "yes" ? "approve" : "deny",
  };
}

function buildResolvedByLabel(params: Parameters<CommandHandler>[0]): string {
  const channel = params.command.channel;
  const sender = params.command.senderId ?? "unknown";
  return `${channel}:${sender}`;
}

export const handleWalletApprovalText: CommandHandler = async (params) => {
  const normalized = params.command.commandBodyNormalized;
  const parsed = parseWalletApproval(normalized);
  if (!parsed) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring wallet approval response from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!parsed.ok) {
    return { shouldContinue: false, reply: { text: parsed.error } };
  }

  const resolvedBy = buildResolvedByLabel(params);
  try {
    await callGateway({
      method: "wallet.approval.resolve",
      params: { id: parsed.id, decision: parsed.decision },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: `Chat approval (${resolvedBy})`,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
    });
  } catch (err) {
    return {
      shouldContinue: false,
      reply: {
        text: `❌ Failed to submit wallet approval: ${String(err)}`,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: { text: `✅ Wallet approval ${parsed.decision} submitted for ${parsed.id}.` },
  };
};
