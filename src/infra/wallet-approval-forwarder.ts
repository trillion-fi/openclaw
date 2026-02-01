import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import type {
  WalletApprovalForwardingConfig,
  WalletApprovalForwardTarget,
} from "../config/types.approvals.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import type { WalletApprovalDecision } from "../gateway/wallet-approval-manager.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import { resolveSessionDeliveryTarget } from "./outbound/targets.js";
import { resolveTelegramInlineButtonsScope } from "../telegram/inline-buttons.js";

const log = createSubsystemLogger("gateway/wallet-approvals");

export type WalletApprovalRequest = {
  id: string;
  request: {
    kind: string;
    from: string;
    messageHash?: string | null;
    messagePreview?: string | null;
    messageSize?: number | null;
    agentId?: string | null;
    sessionKey?: string | null;
  };
  createdAtMs: number;
  expiresAtMs: number;
};

export type WalletApprovalResolved = {
  id: string;
  decision: WalletApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
};

type ForwardTarget = WalletApprovalForwardTarget & { source: "session" | "target" };

type PendingApproval = {
  request: WalletApprovalRequest;
  targets: ForwardTarget[];
  timeoutId: NodeJS.Timeout | null;
};

export type WalletApprovalForwarder = {
  handleRequested: (request: WalletApprovalRequest) => Promise<void>;
  handleResolved: (resolved: WalletApprovalResolved) => Promise<void>;
  stop: () => void;
};

export type WalletApprovalForwarderDeps = {
  getConfig?: () => OpenClawConfig;
  deliver?: typeof deliverOutboundPayloads;
  nowMs?: () => number;
  resolveSessionTarget?: (params: {
    cfg: OpenClawConfig;
    request: WalletApprovalRequest;
  }) => WalletApprovalForwardTarget | null;
};

const DEFAULT_MODE = "session" as const;

function normalizeMode(mode?: WalletApprovalForwardingConfig["mode"]) {
  return mode ?? DEFAULT_MODE;
}

function matchSessionFilter(sessionKey: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try {
      return sessionKey.includes(pattern) || new RegExp(pattern).test(sessionKey);
    } catch {
      return sessionKey.includes(pattern);
    }
  });
}

function shouldForward(params: {
  config?: WalletApprovalForwardingConfig;
  request: WalletApprovalRequest;
}): boolean {
  const config = params.config;
  if (!config?.enabled) {
    return false;
  }
  if (config.agentFilter?.length) {
    const agentId =
      params.request.request.agentId ??
      parseAgentSessionKey(params.request.request.sessionKey)?.agentId;
    if (!agentId) {
      return false;
    }
    if (!config.agentFilter.includes(agentId)) {
      return false;
    }
  }
  if (config.sessionFilter?.length) {
    const sessionKey = params.request.request.sessionKey;
    if (!sessionKey) {
      return false;
    }
    if (!matchSessionFilter(sessionKey, config.sessionFilter)) {
      return false;
    }
  }
  return true;
}

function buildTargetKey(target: WalletApprovalForwardTarget): string {
  const channel = normalizeMessageChannel(target.channel) ?? target.channel;
  const accountId = target.accountId ?? "";
  const threadId = target.threadId ?? "";
  return [channel, target.to, accountId, threadId].join(":");
}

function buildRequestMessage(request: WalletApprovalRequest, nowMs: number) {
  const lines: string[] = ["🔐 Wallet approval required", `ID: ${request.id}`];
  lines.push(`Action: ${request.request.kind}`);
  lines.push(`From: ${request.request.from}`);
  if (request.request.agentId) {
    lines.push(`Agent: ${request.request.agentId}`);
  }
  if (request.request.sessionKey) {
    lines.push(`Session: ${request.request.sessionKey}`);
  }
  if (request.request.messageHash) {
    lines.push(`Message hash: ${request.request.messageHash}`);
  }
  if (request.request.messagePreview) {
    lines.push(`Message: ${request.request.messagePreview}`);
  }
  if (typeof request.request.messageSize === "number") {
    lines.push(`Message size: ${request.request.messageSize} chars`);
  }
  const expiresIn = Math.max(0, Math.round((request.expiresAtMs - nowMs) / 1000));
  lines.push(`Expires in: ${expiresIn}s`);
  lines.push(`Reply with: yes ${request.id}`);
  lines.push(`Or: no ${request.id}`);
  return lines.join("\n");
}

function decisionLabel(decision: WalletApprovalDecision): string {
  return decision === "approve" ? "approved" : "denied";
}

function buildResolvedMessage(resolved: WalletApprovalResolved) {
  const base = `✅ Wallet approval ${decisionLabel(resolved.decision)}.`;
  const by = resolved.resolvedBy ? ` Resolved by ${resolved.resolvedBy}.` : "";
  return `${base}${by} ID: ${resolved.id}`;
}

function buildExpiredMessage(request: WalletApprovalRequest) {
  return `⏱️ Wallet approval expired. ID: ${request.id}`;
}

function defaultResolveSessionTarget(params: {
  cfg: OpenClawConfig;
  request: WalletApprovalRequest;
}): WalletApprovalForwardTarget | null {
  const sessionKey = params.request.request.sessionKey?.trim();
  if (!sessionKey) {
    return null;
  }
  const parsed = parseAgentSessionKey(sessionKey);
  const agentId = parsed?.agentId ?? params.request.request.agentId ?? "main";
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) {
    return null;
  }
  const target = resolveSessionDeliveryTarget({ entry, requestedChannel: "last" });
  if (!target.channel || !target.to) {
    return null;
  }
  if (!isDeliverableMessageChannel(target.channel)) {
    return null;
  }
  return {
    channel: target.channel,
    to: target.to,
    accountId: target.accountId,
    threadId: target.threadId,
  };
}

function buildTelegramButtons(id: string) {
  return [
    [
      { text: "Approve", callback_data: `yes ${id}` },
      { text: "Deny", callback_data: `no ${id}` },
    ],
  ];
}

async function deliverToTargets(params: {
  cfg: OpenClawConfig;
  targets: ForwardTarget[];
  text: string;
  deliver: typeof deliverOutboundPayloads;
  shouldSend?: () => boolean;
  buttons?: (target: ForwardTarget) => Array<Array<{ text: string; callback_data: string }>> | null;
}) {
  const deliveries = params.targets.map(async (target) => {
    if (params.shouldSend && !params.shouldSend()) {
      return;
    }
    const channel = normalizeMessageChannel(target.channel) ?? target.channel;
    if (!isDeliverableMessageChannel(channel)) {
      return;
    }
    const payload =
      params.buttons && channel === "telegram"
        ? {
            text: params.text,
            buttons: params.buttons(target) ?? undefined,
          }
        : { text: params.text };
    try {
      await params.deliver({
        cfg: params.cfg,
        channel,
        to: target.to,
        accountId: target.accountId,
        threadId: target.threadId,
        payloads: [payload],
      });
    } catch (err) {
      log.error(`wallet approvals: failed to deliver to ${channel}:${target.to}: ${String(err)}`);
    }
  });
  await Promise.allSettled(deliveries);
}

export function createWalletApprovalForwarder(
  deps: WalletApprovalForwarderDeps = {},
): WalletApprovalForwarder {
  const getConfig = deps.getConfig ?? loadConfig;
  const deliver = deps.deliver ?? deliverOutboundPayloads;
  const nowMs = deps.nowMs ?? Date.now;
  const resolveSessionTarget = deps.resolveSessionTarget ?? defaultResolveSessionTarget;
  const pending = new Map<string, PendingApproval>();

  const handleRequested = async (request: WalletApprovalRequest) => {
    const cfg = getConfig();
    const config = cfg.approvals?.wallet;
    if (!shouldForward({ config, request })) {
      return;
    }

    const mode = normalizeMode(config?.mode);
    const targets: ForwardTarget[] = [];
    const seen = new Set<string>();

    if (mode === "session" || mode === "both") {
      const sessionTarget = resolveSessionTarget({ cfg, request });
      if (sessionTarget) {
        const key = buildTargetKey(sessionTarget);
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ ...sessionTarget, source: "session" });
        }
      }
    }

    if (mode === "targets" || mode === "both") {
      const explicitTargets = config?.targets ?? [];
      for (const target of explicitTargets) {
        const key = buildTargetKey(target);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        targets.push({ ...target, source: "target" });
      }
    }

    if (targets.length === 0) {
      return;
    }

    const text = buildRequestMessage(request, nowMs());
    await deliverToTargets({
      cfg,
      targets,
      text,
      deliver,
      buttons: (target) => {
        const channel = normalizeMessageChannel(target.channel) ?? target.channel;
        if (channel !== "telegram") {
          return null;
        }
        const scope = resolveTelegramInlineButtonsScope({
          cfg,
          accountId: target.accountId ?? null,
        });
        if (scope === "off") {
          return null;
        }
        return buildTelegramButtons(request.id);
      },
    });

    const key = request.id;
    const expiresAt = request.expiresAtMs;
    const timeoutMs = Math.max(0, expiresAt - nowMs() + 250);
    const timeoutId = setTimeout(() => {
      const entry = pending.get(key);
      if (!entry) {
        return;
      }
      pending.delete(key);
      const expiredText = buildExpiredMessage(entry.request);
      void deliverToTargets({
        cfg,
        targets: entry.targets,
        text: expiredText,
        deliver,
      });
    }, timeoutMs);
    pending.set(key, { request, targets, timeoutId });
  };

  const handleResolved = async (resolved: WalletApprovalResolved) => {
    const entry = pending.get(resolved.id);
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    if (entry) {
      pending.delete(resolved.id);
    }
    const cfg = getConfig();
    const config = cfg.approvals?.wallet;
    if (!config?.enabled) {
      return;
    }
    const targets = entry?.targets ?? [];
    if (targets.length === 0) {
      return;
    }
    const text = buildResolvedMessage(resolved);
    await deliverToTargets({
      cfg,
      targets,
      text,
      deliver,
      buttons: (target) => {
        const channel = normalizeMessageChannel(target.channel) ?? target.channel;
        if (channel !== "telegram") {
          return null;
        }
        const scope = resolveTelegramInlineButtonsScope({
          cfg,
          accountId: target.accountId ?? null,
        });
        if (scope === "off") {
          return null;
        }
        // Disable buttons after resolution by removing them.
        return [];
      },
    });
  };

  const stop = () => {
    for (const [, entry] of pending) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    pending.clear();
  };

  return { handleRequested, handleResolved, stop };
}
