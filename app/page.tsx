"use client";

import { useState } from "react";

import UsageTab from "./components/UsageTab";
import styles from "./page.module.css";

import { explorerTransactionUrl, type ProductState } from "../lib/session";

/**
 * The UsageBar landing page.
 *
 * Build spec Section 0C locks the composition: a restrained header, the
 * proposition on the left, and the Usage Tab as the dominant object on the
 * right, collapsing to a single column on narrow screens.
 *
 * Two things this page refuses to do, both of which the build spec makes
 * non-negotiable:
 *
 *   1. It does not invent protocol data. There is no session here yet, so the
 *      tab renders in READY with a PROPOSED ceiling and says plainly that
 *      nothing is on chain. Section 0C forbids copying the reference image's
 *      example amounts and transaction data into real behaviour.
 *
 *   2. It does not claim a result it has not read back. The state machine is
 *      driven by verified chain state (Section 12), and the Devnet adapter
 *      that supplies it is not connected in this build — so the actions say
 *      so rather than advancing the machine on optimism.
 *
 * The footer is the exception that proves the rule: every entry there is a
 * real, confirmable Devnet transaction, and each links to the explorer.
 */

/** The configured ceiling for the demo service. Not a chain value. */
const CEILING_ATOMIC = 50_000_000n;
/** The verified test mint has six decimals. Never assumed — see lib/amounts.ts. */
const DECIMALS = 6;
const UNIT = "TEST";

/**
 * The evidence footer. Every signature below was produced by a real run of
 * this repository's own tooling against Solana Devnet, and each is
 * independently checkable on the explorer. This is the honest version of a
 * "trust us" section: it asks the reader to verify rather than to believe.
 */
const EVIDENCE = [
  {
    claim: "A channel was opened and the deposit moved into escrow",
    signature: "2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh",
  },
  {
    claim: "The settled watermark advanced on a cumulative voucher",
    signature: "3wesVbuGwEA9ETkAUUG1L1We6GSCVhb2ojimHRv7Bh468ryDJrTtLtHVQnRmYc62E7KJyKSwnSwsJCoKnyNn4uNG",
  },
  {
    claim: "The channel was sealed at its final metered amount",
    signature: "3WjdkDYv9UCazfz9EQyZ7mPTnkdbU2vFVpseCyFRAYqnKJUcTfgHYUizvhayKKpPL5MR3qqGLp32xrhxESHJfZ8p",
  },
  {
    claim: "The provider was paid, the customer refunded, escrow emptied",
    signature: "51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A",
  },
] as const;

export default function Page() {
  const [state, setState] = useState<ProductState>("READY");
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Neither action advances the state machine yet, and that is deliberate.
   * Moving to OPENING without a submitted transaction would be exactly the
   * optimistic state Section 12 forbids. Once the Devnet adapter lands, these
   * become real submissions and the state follows the chain, not the click.
   */
  const explainNotConnected = (action: string) => {
    setNotice(
      `${action} is not connected in this build: the Devnet chain adapter is still being wired. ` +
        "No transaction has been sent and no state has changed. Everything the tab shows below is " +
        "a proposal, not a deposit.",
    );
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.wordmark}>UsageBar</span>

          <nav className={styles.nav} aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#evidence">Evidence</a>
          </nav>

          <div className={styles.headerActions}>
            <span className={styles.network}>Devnet · test funds</span>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => explainNotConnected("Wallet connection")}
            >
              Connect wallet
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.proposition} id="how">
          <span className="eyebrow">Camera rental · pay per use</span>

          <h1 className="display">Pay for what you actually use.</h1>

          <p className="lede">
            Open one payment tab. Let usage build the bill. Settle once at the end — and get back
            whatever you did not spend.
          </p>

          <ol className={styles.steps}>
            <li>
              <span className={styles.stepIndex}>01</span> Open tab
            </li>
            <li>
              <span className={styles.stepIndex}>02</span> Use service
            </li>
            <li>
              <span className={styles.stepIndex}>03</span> Close &amp; settle
            </li>
          </ol>
        </section>

        <div className={styles.tabColumn}>
          {notice !== null && (
            <p className={styles.banner} role="status">
              {notice}
            </p>
          )}

          <UsageTab
            state={state}
            serviceName="Camera Rental"
            serviceMeta="Six-minute rental · billed by the second"
            unitLabel={UNIT}
            ceiling={CEILING_ATOMIC}
            settled={0n}
            decimals={DECIMALS}
            provenance="PROPOSED"
            facts={null}
            updates={[]}
            onOpen={() => explainNotConnected("Opening a tab")}
            onClose={() => explainNotConnected("Closing and settling")}
          />
        </div>
      </main>

      <footer className={styles.footer} id="evidence">
        <div className={styles.footerInner}>
          <h2 className={styles.footerTitle}>Verified on Solana Devnet</h2>

          <ul className={styles.evidence}>
            {EVIDENCE.map((entry) => (
              <li className={styles.evidenceItem} key={entry.signature}>
                <span className={styles.evidenceClaim}>{entry.claim}</span>
                <a
                  className={styles.evidenceProof}
                  href={explorerTransactionUrl(entry.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {entry.signature}
                </a>
              </li>
            ))}
          </ul>

          <p className={styles.footerNote}>
            Each signature above is a real transaction on Solana Devnet, produced by this
            repository&rsquo;s own tooling against the live Payment Channels program, and each can
            be checked on the explorer. This is the whole lifecycle: money into escrow, the meter
            advanced by signed cumulative vouchers, then a close that paid the provider and
            returned the unused remainder. It runs on Devnet with test funds, and has not been
            audited — see <code>docs/CLAIM_STATUS.md</code> for exactly what is proven and what is
            not.
          </p>
        </div>
      </footer>
    </div>
  );
}
