import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { SolanaWalletService } from "../../wallet/solana-wallet-service.js";
import { WalletApprovalManager } from "../wallet-approval-manager.js";
import { createWalletApprovalHandlers } from "./wallet-approval.js";
import { createWalletSolanaHandlers } from "./wallet-solana.js";

const noop = () => {};

describe("wallet solana handlers", () => {
  it("signs a message after approval", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-wallet-solana-"));
    const wallet = new SolanaWalletService({ stateDir });
    wallet.init({ password: "pw" });
    wallet.unlock({ password: "pw", ttlMs: 60_000 });

    const approvals = new WalletApprovalManager();
    const solHandlers = createWalletSolanaHandlers(wallet, { approvals });
    const approvalHandlers = createWalletApprovalHandlers(approvals);

    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const respond = vi.fn();
    const context = {
      broadcast: (event: string, payload: unknown) => broadcasts.push({ event, payload }),
      logGateway: { error: vi.fn() },
    };

    const signPromise = solHandlers["wallet.solana.signMessage"]({
      params: { message: "hello", timeoutMs: 5_000 },
      respond,
      context: context as unknown as Parameters<
        (typeof solHandlers)["wallet.solana.signMessage"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "wallet.solana.signMessage" },
      isWebchatConnect: noop,
    });

    const requested = broadcasts.find((entry) => entry.event === "wallet.approval.requested");
    expect(requested).toBeTruthy();
    const id = (requested?.payload as { id?: string })?.id ?? "";
    expect(id).toMatch(/^wallet_/);

    const resolveRespond = vi.fn();
    await approvalHandlers["wallet.approval.resolve"]({
      params: { id, decision: "approve" },
      respond: resolveRespond,
      context: context as unknown as Parameters<
        (typeof approvalHandlers)["wallet.approval.resolve"]
      >[0]["context"],
      client: { connect: { client: { id: "cli", displayName: "CLI" } } },
      req: { id: "req-2", type: "req", method: "wallet.approval.resolve" },
      isWebchatConnect: noop,
    });

    await signPromise;

    expect(resolveRespond).toHaveBeenCalledWith(true, { ok: true }, undefined);
    expect(broadcasts.some((entry) => entry.event === "wallet.approval.resolved")).toBe(true);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id,
        decision: "approve",
        signature: expect.any(String),
      }),
      undefined,
    );
  });

  it("returns deny decision without signing", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-wallet-solana-"));
    const wallet = new SolanaWalletService({ stateDir });
    wallet.init({ password: "pw" });
    wallet.unlock({ password: "pw", ttlMs: 60_000 });

    const approvals = new WalletApprovalManager();
    const solHandlers = createWalletSolanaHandlers(wallet, { approvals });
    const approvalHandlers = createWalletApprovalHandlers(approvals);

    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const respond = vi.fn();
    const context = {
      broadcast: (event: string, payload: unknown) => broadcasts.push({ event, payload }),
      logGateway: { error: vi.fn() },
    };

    const signPromise = solHandlers["wallet.solana.signMessage"]({
      params: { message: "hello", timeoutMs: 5_000 },
      respond,
      context: context as unknown as Parameters<
        (typeof solHandlers)["wallet.solana.signMessage"]
      >[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "wallet.solana.signMessage" },
      isWebchatConnect: noop,
    });

    const requested = broadcasts.find((entry) => entry.event === "wallet.approval.requested");
    const id = (requested?.payload as { id?: string })?.id ?? "";
    expect(id).toMatch(/^wallet_/);

    await approvalHandlers["wallet.approval.resolve"]({
      params: { id, decision: "deny" },
      respond: vi.fn(),
      context: context as unknown as Parameters<
        (typeof approvalHandlers)["wallet.approval.resolve"]
      >[0]["context"],
      client: { connect: { client: { id: "cli", displayName: "CLI" } } },
      req: { id: "req-2", type: "req", method: "wallet.approval.resolve" },
      isWebchatConnect: noop,
    });

    await signPromise;

    const payload = respond.mock.calls[0]?.[1] as { decision?: unknown; signature?: unknown };
    expect(payload.decision).toBe("deny");
    expect(payload.signature).toBeUndefined();
  });
});

