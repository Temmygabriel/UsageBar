/**
 * Phase 0 placeholder.
 *
 * This is deliberately NOT the UsageBar interface. Per the build spec
 * (Section 85, Phase 8), visual implementation does not begin until the
 * Devnet protocol gate passes: a real channel opened on Devnet and read
 * back from chain.
 *
 * No financial or protocol values are displayed here, because none have
 * been proven yet. See docs/CLAIM_STATUS.md.
 */
export default function Page() {
  return (
    <main>
      <h1>UsageBar</h1>
      <p>Pay for what you actually use.</p>
      <hr />
      <p>
        <strong>Status: Phase 0 — repository scaffold only.</strong>
      </p>
      <p>
        No usage session is shown yet. The interface is not built until a real
        payment channel has been opened on Solana Devnet and read back from
        chain. Until that happens, every financial value on this page would be
        invented, and this project does not invent protocol results.
      </p>
      <p>
        See <code>docs/AUDIT_REPORT.md</code> for the verified protocol findings
        and <code>docs/CLAIM_STATUS.md</code> for what is proven versus unproven.
      </p>
    </main>
  );
}
