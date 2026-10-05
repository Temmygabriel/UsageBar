# Tools

**This directory is intentionally empty.**

It will hold `verify-canonical-run.ts` (build spec Section 29), whose job is to
check the evidence in `evidence/` independently.

The verifier must **not** trust the evidence JSON alone. Where practical it must
query Solana and confirm:

- the network matches the expected network;
- the program matches the verified program ID;
- the asset matches the verified mint and token program;
- transaction signatures are syntactically valid;
- the transactions actually exist on the selected cluster;
- required transactions succeeded rather than merely being present;
- protocol state matches the expected final state;
- amounts reconcile: `authorized = settled + unused`;
- no fabricated proof values exist.

It should fail loudly, and it should be runnable in GitHub Actions so the check
is reproducible rather than a claim.

Not written yet — it is written after there is a real run to verify. A verifier
built before the evidence exists would only be able to validate invented data.
