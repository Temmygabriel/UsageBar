# Evidence

**This directory is intentionally empty.**

It will hold the canonical run `canonical-usagebar-devnet-001` — the artifacts
that prove UsageBar works on Solana Devnet with real transactions.

Build spec Section 26 defines the intended layout:

```
evidence/canonical-run/
  01-environment.json
  02-channel-open.json
  03-voucher-01.json
  ...
  08-close.json
  09-settlement.json
  10-distribution.json
  11-final-state.json
  12-verification.json
```

**Rules:**

- No file here may contain a private key, seed phrase, access token, or any
  other secret.
- No file here may be hand-edited. Values come from chain reads or from
  application observations, and each file must say which it is.
- If a protocol step does not exist in the chosen implementation, no file is
  fabricated for it. Section 26 says so explicitly, and it matters: an invented
  evidence file is worse than a missing one.
- Timestamps that are application observations must not be presented as
  blockchain timestamps.

Nothing exists here yet because no run has been performed. When the protocol
gate passes, the first real artifacts land here.
