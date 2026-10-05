"use client";

import UsageTab from "./components/UsageTab";
import styles from "./page.module.css";

import { abbreviate, explorerTransactionUrl } from "../lib/session";
import { useSession, type Notice } from "../lib/use-session";

/**
 * The UsageBar landing page.
 *
 * Build spec Section 0C locks the composition: a restrained header, the
 * proposition on the left, and the Usage Tab as the dominant object on the
 * right, collapsing to a single column on narrow screens.
 *
 * The page itself holds no protocol logic and no chain access. Everything that
 * touches Solana lives in `lib/use-session.ts`, and everything that decides what
 * a number means lives in `lib/session.ts`. This file's job is to put the right
 * thing on screen and to name, honestly, what the next real step is.
 *
 * WHY THE PRIMARY BUTTON CHANGES LABEL
 *
 * The customer's key is their own — that is the product, not a detail of it. So
 * the first step is connecting a wallet, and the second is getting Devnet funds
 * into it. A button that always said "Open tab" would be lying on a fresh
 * browser, because that is not what pressing it would do. It names the step that
 * will actually happen instead.
 */

/** The cluster every link and every claim on this page refers to. */
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

/**
 * The evidence footer.
 *
 * Every signature below was produced by a real run of this repository's own
 * tooling against Solana Devnet, and each is independently checkable. This is
 * the honest version of a "trust us" section: it asks the reader to verify
 * rather than to believe.
 *
 * These are the standalone runs that proved the protocol works, not
 * transactions from the live demo above. The distinction matters and the note
 * below the list says so.
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
    signature: "3WjdkDYv9UCazfz9EQYz7mPTnkdbU2vFVpseCyFRAYqnKJUcTfgHYUizvhayKKpPL5MR3qqGLp32xrhxESHJfZ8p",
  },
  {
    claim: "The provider was paid, the customer refunded, escrow emptied",
    signature: "51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A",
  },
] as const;

/** Map a notice tone onto a banner style. */
function bannerClass(tone: Notice["tone"]): string {
  const base = styles.banner;
  switch (tone) {
    case "success":
      return `${base} ${styles.bannerSuccess}`;
    case "error":
      return `${base} ${styles.bannerError}`;
    case "info":
      return `${base} ${styles.bannerInfo}`;
    case "warn":
      return base;
  }
}

/** A whole number of TEST, for prose. Only ever used for the rate, never money. */
function ratePerSecond(atomicPerSecond: string, decimals: number): string {
  const value = Number(atomicPerSecond) / 10 ** decimals;
  return value >= 1 ? value.toFixed(2) : value.toString();
}

export default function Page() {
  const { state, actions } = useSession();
  const { wallet, service, channel, facts, updates, notice, busy, balances } = state;

  const decimals = service?.decimals ?? 6;
  const unit = "TEST";

  const connected = wallet.status === "connected";
  const hasChannel = channel !== null;

  /** Until a channel exists, the ceiling is a proposal. After that, it is the deposit. */
  const ceiling = hasChannel ? BigInt(channel.deposit) : BigInt(service?.ceilingAtomic ?? "50000000");
  const settled = hasChannel ? BigInt(channel.settled) : 0n;

  /**
   * Whether this wallet needs test funds before it can open a tab.
   *
   * Only ever true on a positive reading. If the balance could not be read,
   * `balances` is null and this stays false, so a failure to check sends nobody
   * to a faucet they may not need.
   */
  const shortOnFunds =
    connected &&
    !hasChannel &&
    balances !== null &&
    (balances.tokens === null || balances.tokens < ceiling);

  /**
   * The next real step, named. Order matters: no wallet, then no funds, then open.
   */
  const openLabel = !connected
    ? "Connect wallet"
    : shortOnFunds
      ? "Get test funds"
      : "Open tab";

  const onPrimary = !connected ? actions.connect : shortOnFunds ? actions.fund : actions.open;

  const blockedReason = shortOnFunds
    ? `Your wallet needs Devnet SOL and ${unit} before it can fund a deposit. Pressing the ` +
      "button above sends both. They are worthless by design."
    : null;

  const serviceMeta = service
    ? `Billed by the second · ${ratePerSecond(service.rateAtomicPerSecond, decimals)} ${unit} per second`
    : "Billed by the second";

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
            <span className={styles.network}>{CLUSTER} · test funds</span>

            {connected ? (
              <>
                <span className={`chip chip-verified ${styles.walletChip}`}>
                  <span className="chip-dot" />
                  {abbreviate(wallet.address ?? "", 4, 4)}
                </span>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={actions.disconnect}
                  disabled={busy}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-quiet"
                onClick={actions.connect}
                disabled={busy || wallet.status === "connecting"}
              >
                {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
              </button>
            )}
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
            <p className={bannerClass(notice.tone)} role="status">
              {notice.text}
            </p>
          )}

          <UsageTab
            state={state.state}
            serviceName="Camera Rental"
            serviceMeta={serviceMeta}
            unitLabel={unit}
            ceiling={ceiling}
            settled={settled}
            decimals={decimals}
            provenance={hasChannel ? "ON_CHAIN" : "PROPOSED"}
            facts={facts}
            updates={updates}
            onOpen={onPrimary}
            onClose={actions.close}
            openLabel={openLabel}
            blockedReason={blockedReason}
          />
        </div>
      </main>

      <footer className={styles.footer} id="evidence">
        <div className={styles.footerInner}>
          <h2 className={styles.footerTitle}>Verified on Solana {CLUSTER}</h2>

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
            Each signature above is a real transaction on Solana {CLUSTER}, produced by this
            repository&rsquo;s own tooling against the live Payment Channels program, and each can
            be checked on the explorer. Together they are the whole lifecycle: money into escrow,
            the meter advanced by signed cumulative vouchers, then a close that paid the provider
            and returned the unused remainder. Those four are from the standalone runs that proved
            the protocol; a tab you open above produces its own. Everything runs on {CLUSTER} with
            test funds, nothing here has been audited, and{" "}
            <code>docs/CLAIM_STATUS.md</code> records exactly what is proven and what is not.
          </p>
        </div>
      </footer>
    </div>
  );
}
