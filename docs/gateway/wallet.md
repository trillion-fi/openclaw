---
summary: "Gateway-native wallet (EVM + Solana) with approval-gated message signing"
read_when:
  - You want the Gateway to hold an EVM or Solana key
  - You want approval-gated message signing
  - You want to forward wallet approvals into chat
title: "Gateway Wallet"
---

# Gateway wallet

OpenClaw includes a **Gateway-native wallet** intended for small, high-trust operations that
benefit from having stable keys available on the Gateway host (for example, signing an EIP-191
message on EVM, or a standard message signature on Solana).

This wallet is:

- **Encrypted at rest** in the OpenClaw state directory (`OPENCLAW_STATE_DIR`)
- **Unlocked in memory** for a short TTL
- **Approval-gated** for signing operations (operator must approve)

## Storage and persistence

The keystores are stored under the state directory:

- EVM: `$OPENCLAW_STATE_DIR/wallets/evm/default.json`
- Solana: `$OPENCLAW_STATE_DIR/wallets/solana/default.json`

Notes:

- The password is **not stored**. It is used to decrypt the keystore when unlocking.
- If you delete or lose `OPENCLAW_STATE_DIR`, you lose access to the wallet key.
- For cloud deployments, mount `OPENCLAW_STATE_DIR` on a persistent volume.

## Control UI

The browser Control UI includes a **Wallet** tab:

- Create wallets (one-time initialization per chain)
- Unlock and lock wallets
- View wallet addresses

When a signing request is pending, the Control UI also shows a **wallet approval prompt** with
Approve and Deny actions.

See: [Control UI](/web/control-ui)

## Gateway API

Wallet operations are exposed over the Gateway WebSocket protocol:

- EVM:
  - `wallet.evm.status` (read)
  - `wallet.evm.init` (write)
  - `wallet.evm.unlock` (write, optional `ttlMs`)
  - `wallet.evm.lock` (write)
  - `wallet.evm.signMessage` (write, approval-gated)
  - `wallet.evm.signTransaction` (write, approval-gated)
- Solana:
  - `wallet.solana.status` (read)
  - `wallet.solana.init` (write)
  - `wallet.solana.unlock` (write, optional `ttlMs`)
  - `wallet.solana.lock` (write)
  - `wallet.solana.signMessage` (write, approval-gated)
  - `wallet.solana.signTransaction` (write, approval-gated)

This feature introduces the wallet approval flow:

- Event: `wallet.approval.requested` (requires `operator.approvals` scope)
- Method: `wallet.approval.resolve` with `{ id, decision: "approve" | "deny" }`
- Event: `wallet.approval.resolved` (requires `operator.approvals` scope)

See: [Gateway protocol](/gateway/protocol)

## Approval flow

`wallet.<chain>.signMessage` and `wallet.<chain>.signTransaction` always create an approval request:

1. Gateway broadcasts `wallet.approval.requested` to operator clients with `operator.approvals`.
2. An operator resolves it by calling `wallet.approval.resolve` (or via a UI surface).
3. If approved, the gateway signs the message and returns `{ signature }`.
4. If denied or expired, the gateway returns a decision without a signature.

Wallet approvals are designed so the message is visible to the operator before signing:

- `messageHash` is included
  - EVM `signMessage`: EIP-191 `hashMessage`
  - EVM `signTransaction`: transaction `unsignedHash`
  - Solana `signMessage`: `sha256:<hex>` of UTF-8 message bytes
  - Solana `signTransaction`: `sha256:<hex>` of transaction message bytes
- `messagePreview` is included (truncated)

## Forwarding wallet approvals to chat

Wallet approvals can optionally be forwarded into chat channels (including plugin channels).
This is useful when operators approve actions from a messaging surface instead of the Control UI.

Config lives under `approvals.wallet` in `openclaw.json`:

```json5
{
  approvals: {
    wallet: {
      enabled: true,
      // session: send to the originating chat (based on session metadata)
      // targets: send to explicit targets listed below
      // both: send to both
      mode: "session",
      // optional filters
      agentFilter: ["main"],
      sessionFilter: ["agent:"],
      // used when mode includes "targets"
      targets: [
        { channel: "telegram", to: "chat:123456789" },
        { channel: "discord", to: "channel:1234567890" },
      ],
    },
  },
}
```

Forwarded messages include an approval ID. To resolve from chat, reply with:

- `yes <id>` to approve
- `no <id>` to deny

Only **authorized senders** can resolve approvals from chat.

## Agent tool

Agents can use the built-in tool `wallet`:

- `action: "status"` reads wallet status (optionally pass `chain`)
- `action: "signMessage"` requests an approval-gated signature (requires `chain`)
- `action: "signTransaction"` requests an approval-gated transaction signature (requires `chain`)

For best routing when approvals are forwarded to chat, include `sessionKey` and `agentId` in the
`signMessage` / `signTransaction` tool call so the gateway can map the approval to the correct conversation.
