---
summary: "Approval-gated message signing via the built-in wallet tool"
read_when:
  - You want an agent to sign messages with a Gateway-native wallet
  - You want a human approval step before signing
title: "Wallet Tool"
---

# Wallet tool

OpenClaw includes a built-in tool named `wallet`.
It is **not** a skill and does not need to be installed.

The `wallet` tool talks to the **Gateway wallet** to:

- Read wallet status for EVM and Solana
- Request an approval-gated message signature

See also: [Gateway wallet](/gateway/wallet)

## Prerequisites

Before an agent can sign messages:

1. Create the wallet keypair (one-time): `wallet.<chain>.init`
2. Unlock the wallet in memory: `wallet.<chain>.unlock`

These steps are typically done in the browser Control UI Wallet tab.
The unlock step uses a password that is not stored and unlocks for a short TTL by default.

## Actions

### Status

Check wallet status for both chains:

```json
{ "action": "status" }
```

Check a single chain:

```json
{ "action": "status", "chain": "evm" }
```

### Sign message

Request a signature on a specific chain:

```json
{
  "action": "signMessage",
  "chain": "evm",
  "message": "example message"
}
```

This always triggers a **wallet approval** and blocks until an operator approves, denies, or the request expires.

Approving can be done either:

- In the Control UI approval prompt, or
- In chat by replying `yes <id>` or `no <id>` when wallet approval forwarding is enabled

For chat-based approvals, include `sessionKey` and `agentId` so the gateway can route approval prompts back to the right conversation.

## Tool availability

The tool list sent to the model is controlled by tool policy:

- `tools.profile` sets the base allowlist
- `tools.allow` / `tools.deny` further restrict it
- `tools.alsoAllow` adds tools on top of the profile

If you are using a restrictive allowlist and want the wallet tool available everywhere, add it via `tools.alsoAllow: ["wallet"]`.

