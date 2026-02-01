---
summary: "Gateway-native EVM wallet with approval-gated message signing"
read_when:
  - You want the Gateway to hold an EVM key
  - You want approval-gated message signing
  - You want to forward wallet approvals into chat
title: "Gateway Wallet"
---

# Gateway wallet (EVM)

OpenClaw includes a **Gateway-native EVM wallet** intended for small, high-trust operations that
benefit from having a stable key available on the Gateway host (for example, signing an EIP-191
message).

This wallet is:

- **Encrypted at rest** in the OpenClaw state directory (`OPENCLAW_STATE_DIR`)
- **Unlocked in memory** for a short TTL
- **Approval-gated** for signing operations (operator must approve)

## Storage and persistence

The EVM keystore is stored under the state directory:

- Path: `$OPENCLAW_STATE_DIR/wallets/evm/default.json`

Notes:

- The password is **not stored**. It is used to decrypt the keystore when unlocking.
- If you delete or lose `OPENCLAW_STATE_DIR`, you lose access to the wallet key.
- For cloud deployments, mount `OPENCLAW_STATE_DIR` on a persistent volume.

## Control UI

The browser Control UI includes a **Wallet** tab:

- Create a wallet (one-time initialization)
- Unlock and lock the wallet
- View the wallet address

When a signing request is pending, the Control UI also shows a **wallet approval prompt** with
Approve and Deny actions.

See: [Control UI](/web/control-ui)

## Gateway API

Wallet operations are exposed over the Gateway WebSocket protocol:

- `wallet.evm.status` (read) returns whether a wallet exists and whether it is locked
- `wallet.evm.init` (write) creates a new random wallet and writes the encrypted keystore
- `wallet.evm.unlock` (write) decrypts the keystore and keeps the signer in memory
  - optional: `ttlMs` to control auto-lock (default is about 10 minutes)
- `wallet.evm.lock` (write) clears the in-memory signer immediately
- `wallet.evm.signMessage` (write) signs an EIP-191 message **after approval**

This feature introduces the wallet approval flow:

- Event: `wallet.approval.requested` (requires `operator.approvals` scope)
- Method: `wallet.approval.resolve` with `{ id, decision: "approve" | "deny" }`
- Event: `wallet.approval.resolved` (requires `operator.approvals` scope)

See: [Gateway protocol](/gateway/protocol)

## Approval flow

`wallet.evm.signMessage` always creates an approval request:

1. Gateway broadcasts `wallet.approval.requested` to operator clients with `operator.approvals`.
2. An operator resolves it by calling `wallet.approval.resolve` (or via a UI surface).
3. If approved, the gateway signs the message and returns `{ signature }`.
4. If denied or expired, the gateway returns a decision without a signature.

Wallet approvals are designed so the message is visible to the operator before signing:

- `messageHash` is included (EIP-191 `hashMessage`)
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

Agents can use the built-in tool `evm_wallet`:

- `action: "status"` reads wallet status
- `action: "signMessage"` requests an approval-gated signature

For best routing when approvals are forwarded to chat, include `sessionKey` and `agentId` in the
`signMessage` tool call so the gateway can map the approval to the correct conversation.

