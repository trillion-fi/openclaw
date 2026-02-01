import { html, nothing } from "lit";

import { formatMs } from "../format";
import type { WalletEvmStatus, WalletSolanaStatus } from "../controllers/wallet";

type WalletChainStatus = WalletEvmStatus | WalletSolanaStatus;

export type WalletChainProps = {
  title: string;
  subtitle: string;
  connected: boolean;
  loading: boolean;
  busy: boolean;
  status: WalletChainStatus | null;
  error: string | null;
  initPassword: string;
  initPasswordConfirm: string;
  unlockPassword: string;
  onRefresh: () => void;
  onInitPasswordChange: (next: string) => void;
  onInitPasswordConfirmChange: (next: string) => void;
  onUnlockPasswordChange: (next: string) => void;
  onInit: () => void;
  onUnlock: () => void;
  onLock: () => void;
};

export type WalletProps = {
  evm: WalletChainProps;
  solana: WalletChainProps;
};

function renderWalletChain(props: WalletChainProps) {
  const status = props.status;
  const hasWallet = status?.exists === true;
  const address = status?.address ?? null;
  const locked = status?.locked !== false;
  const unlockedUntilMs = status?.unlockedUntilMs ?? null;
  const canInit =
    !props.busy &&
    props.initPassword.trim().length > 0 &&
    props.initPassword === props.initPasswordConfirm;
  const canUnlock = !props.busy && props.unlockPassword.trim().length > 0;
  const statusLine = !props.connected
    ? "Disconnected."
    : props.loading
      ? "Loading…"
      : hasWallet
        ? locked
          ? "Locked."
          : `Unlocked until ${formatMs(unlockedUntilMs)}.`
        : "Not initialized.";

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">${props.title}</div>
        <div class="card-sub">${props.subtitle}</div>

        <div style="margin-top: 14px;">
          <div class="pill ${hasWallet ? "ok" : ""}">
            <span>Status</span>
            <span class="mono">${statusLine}</span>
          </div>
        </div>

        ${address
          ? html`
              <div style="margin-top: 10px;">
                <div class="muted">Address</div>
                <div class="mono">${address}</div>
              </div>
            `
          : nothing}

        ${props.error
          ? html`<div class="pill danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing}

        <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn" ?disabled=${!props.connected || props.loading} @click=${props.onRefresh}>
            Refresh
          </button>
          ${hasWallet && !locked
            ? html`
                <button class="btn danger" ?disabled=${props.busy} @click=${props.onLock}>
                  Lock
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-title">${hasWallet ? "Unlock" : "Create"}</div>
        <div class="card-sub">
          ${hasWallet
            ? "Unlocking never sends your password over chat."
            : "Choose a password to encrypt the wallet key."}
        </div>

        ${hasWallet
          ? html`
              <div class="form-grid" style="margin-top: 16px;">
                <label class="field">
                  <span>Password (not stored)</span>
                  <input
                    type="password"
                    .value=${props.unlockPassword}
                    ?disabled=${props.busy}
                    @input=${(e: Event) =>
                      props.onUnlockPasswordChange((e.target as HTMLInputElement).value)}
                    placeholder="wallet password"
                  />
                </label>
              </div>
              <div style="margin-top: 14px;">
                <button class="btn primary" ?disabled=${!props.connected || !canUnlock} @click=${props.onUnlock}>
                  Unlock
                </button>
              </div>
              <div class="muted" style="margin-top: 10px;">
                Tip: for cloud deployments, mount <span class="mono">OPENCLAW_STATE_DIR</span> on a
                persistent volume to keep the keystore across reinstalls.
              </div>
            `
          : html`
              <div class="form-grid" style="margin-top: 16px;">
                <label class="field">
                  <span>Password (not stored)</span>
                  <input
                    type="password"
                    .value=${props.initPassword}
                    ?disabled=${props.busy}
                    @input=${(e: Event) =>
                      props.onInitPasswordChange((e.target as HTMLInputElement).value)}
                    placeholder="wallet password"
                  />
                </label>
                <label class="field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    .value=${props.initPasswordConfirm}
                    ?disabled=${props.busy}
                    @input=${(e: Event) =>
                      props.onInitPasswordConfirmChange((e.target as HTMLInputElement).value)}
                    placeholder="repeat password"
                  />
                </label>
              </div>
              <div style="margin-top: 14px;">
                <button class="btn primary" ?disabled=${!props.connected || !canInit} @click=${props.onInit}>
                  Create wallet
                </button>
              </div>
              <div class="muted" style="margin-top: 10px;">
                This creates a new random private key and stores it encrypted under
                <span class="mono">OPENCLAW_STATE_DIR</span>. If you delete that directory, you
                lose access.
              </div>
            `}
      </div>
    </section>
  `;
}

export function renderWallet(props: WalletProps) {
  return html`
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${renderWalletChain(props.evm)} ${renderWalletChain(props.solana)}
    </div>
  `;
}
