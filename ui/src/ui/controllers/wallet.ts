import type { GatewayBrowserClient } from "../gateway";

export type WalletEvmStatus = {
  exists: boolean;
  address: string | null;
  locked: boolean;
  unlockedUntilMs: number | null;
};

export type WalletState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  walletEvmLoading: boolean;
  walletEvmBusy: boolean;
  walletEvmStatus: WalletEvmStatus | null;
  walletEvmError: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWalletEvmStatus(value: unknown): WalletEvmStatus | null {
  if (!isRecord(value)) return null;
  const exists = value.exists === true;
  const address = typeof value.address === "string" ? value.address : null;
  const locked = value.locked === true;
  const unlockedUntilMs = typeof value.unlockedUntilMs === "number" ? value.unlockedUntilMs : null;
  return { exists, address, locked, unlockedUntilMs };
}

export async function loadWalletEvmStatus(state: WalletState) {
  if (!state.client || !state.connected) return;
  if (state.walletEvmLoading) return;
  state.walletEvmLoading = true;
  state.walletEvmError = null;
  try {
    const res = await state.client.request("wallet.evm.status", {});
    state.walletEvmStatus = parseWalletEvmStatus(res);
  } catch (err) {
    state.walletEvmError = String(err);
  } finally {
    state.walletEvmLoading = false;
  }
}

export async function initWalletEvm(state: WalletState, password: string) {
  if (!state.client || !state.connected) return;
  if (state.walletEvmBusy) return;
  state.walletEvmBusy = true;
  state.walletEvmError = null;
  try {
    await state.client.request("wallet.evm.init", { password });
    await loadWalletEvmStatus(state);
  } catch (err) {
    state.walletEvmError = String(err);
  } finally {
    state.walletEvmBusy = false;
  }
}

export async function unlockWalletEvm(state: WalletState, password: string) {
  if (!state.client || !state.connected) return;
  if (state.walletEvmBusy) return;
  state.walletEvmBusy = true;
  state.walletEvmError = null;
  try {
    await state.client.request("wallet.evm.unlock", { password });
    await loadWalletEvmStatus(state);
  } catch (err) {
    state.walletEvmError = String(err);
  } finally {
    state.walletEvmBusy = false;
  }
}

export async function lockWalletEvm(state: WalletState) {
  if (!state.client || !state.connected) return;
  if (state.walletEvmBusy) return;
  state.walletEvmBusy = true;
  state.walletEvmError = null;
  try {
    await state.client.request("wallet.evm.lock", {});
    await loadWalletEvmStatus(state);
  } catch (err) {
    state.walletEvmError = String(err);
  } finally {
    state.walletEvmBusy = false;
  }
}

