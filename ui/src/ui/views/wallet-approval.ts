import { html, nothing } from "lit";

import type { AppViewState } from "../app-view-state";

function formatRemaining(ms: number): string {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function renderMetaRow(label: string, value?: string | null) {
  if (!value) return nothing;
  return html`<div class="exec-approval-meta-row"><span>${label}</span><span>${value}</span></div>`;
}

export function renderWalletApprovalPrompt(state: AppViewState) {
  const active = state.walletApprovalQueue[0];
  if (!active) return nothing;
  const request = active.request;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining = remainingMs > 0 ? `expires in ${formatRemaining(remainingMs)}` : "expired";
  const queueCount = state.walletApprovalQueue.length;
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">Wallet approval needed</div>
            <div class="exec-approval-sub">${remaining}</div>
          </div>
          ${queueCount > 1
            ? html`<div class="exec-approval-queue">${queueCount} pending</div>`
            : nothing}
        </div>
        <div class="exec-approval-command mono">${request.kind}</div>
        <div class="exec-approval-meta">
          ${renderMetaRow("From", request.from)}
          ${renderMetaRow("Agent", request.agentId)}
          ${renderMetaRow("Session", request.sessionKey)}
          ${renderMetaRow("Message hash", request.messageHash)}
          ${renderMetaRow("Message", request.messagePreview)}
        </div>
        ${state.walletApprovalError
          ? html`<div class="exec-approval-error">${state.walletApprovalError}</div>`
          : nothing}
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${state.walletApprovalBusy}
            @click=${() => state.handleWalletApprovalDecision("approve")}
          >
            Approve
          </button>
          <button
            class="btn danger"
            ?disabled=${state.walletApprovalBusy}
            @click=${() => state.handleWalletApprovalDecision("deny")}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  `;
}

