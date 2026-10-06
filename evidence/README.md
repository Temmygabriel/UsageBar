# Evidence

This directory holds the canonical run `canonical-usagebar-devnet-001` — the
artifacts that prove UsageBar works on Solana Devnet with real transactions.

Build spec Section 26 defines the layout:

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

## Status

`canonical-run/` is **not populated yet.** The generator is written and lives
at `tools/devnet-canonical-run.mjs`; it runs via the Devnet workflow's
`canonical-run` task and writes all twelve files in one pass, uploading them as
a workflow artifact.

It has not been executed, and this file will not claim otherwise until it has.

What *has* passed so far is a set of narrower gates, each with its own record:

| Gate | Where it is recorded |
|---|---|
| Program and instruction discriminators verified against the deployed IDL | [`../docs/CLAIM_STATUS.md`](../docs/CLAIM_STATUS.md) |
| Wire-format encoding verified, byte for byte, by the test suite | [`../tests/`](../tests/), 94 tests |
| A channel opened, metered, settled and closed by the scripts under `tools/` | [`../PROGRESS.md`](../PROGRESS.md) |

Those are not a substitute for the canonical run, and the distinction is the
reason this file exists rather than being folded into the progress log: a
passing test suite proves an encoder is consistent with itself, and a canonical
run proves the chain agreed.
