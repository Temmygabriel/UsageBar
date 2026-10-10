"use client";

import { useState } from "react";

import UsageTab from "./components/UsageTab";
import styles from "./page.module.css";

import { abbreviate, explorerTransactionUrl } from "../lib/session";
import { useSession, type Notice } from "../lib/use-session";
import { getWalletOptions, type WalletId, type WalletOption } from "../lib/wallet";

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
 * These are independent evidence transactions produced by the repository tooling,
 * not transactions from the live demo above. The distinction matters and the
 * note below the list says so.
 */
const EVIDENCE = [
  {
    claim: "Channel opened and deposit escrowed",
    signature: "2Uoz4SE93ct5v3RrXQnzFhy8Dn4bwi8FBcf817Vm3SjNm1Umi2q9jzxLF95SdEsCC8r2KsKHDYKSo8JaNuDLgoh",
  },
  {
    claim: "Cumulative signed usage accepted",
    signature: "3wesVbuGwEA9ETkAUUG1L1We6GSCVhb2ojimHRv7Bh468ryDJrTtLtHVQnRmYc62E7KJyKSwnSwsJCoKnyNn4uNG",
  },
  {
    claim: "Channel sealed at the final metered amount",
    signature: "3WjdkDYv9UCazfz9EQYz7mPTnkdbU2vFVpseCyFRAYqnKJUcTfgHYUizvhayKKpPL5MR3qqGLp32xrhxESHJfZ8p",
  },
  {
    claim: "Provider paid and unused balance returned",
    signature: "51FcroWv457JrF9aARRxGqzUp8j8Azohtr1KD6q76bxeRjNDVzFPM4YsoSa2fESnHMDPyw4dULvt746stNdaX81A",
  },
] as const;

const WALLET_DOWNLOAD_URLS: Record<WalletId, string> = {
  solflare: "https://www.solflare.com/download/",
  phantom: "https://phantom.app/download",
  okx: "https://web3.okx.com/download",
};

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
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const { wallet, service, channel, facts, updates, notice, busy, balances, settlementProof } = state;

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
  const showWalletPicker = () => {
    setWalletOptions(getWalletOptions());
    setWalletPickerOpen(true);
  };

  const selectWallet = (id: WalletId) => {
    setWalletPickerOpen(false);
    void actions.connect(id);
  };

  const openLabel = !connected
    ? wallet.status === "connecting"
      ? "Cancel connection"
      : "Connect wallet"
    : shortOnFunds
      ? "Get test funds"
      : "Open tab";

  const onPrimary = !connected
    ? wallet.status === "connecting"
      ? actions.cancelConnect
      : showWalletPicker
    : shortOnFunds
      ? actions.fund
      : actions.open;

  const blockedReason = shortOnFunds
    ? `Your wallet needs Devnet SOL and ${unit} before it can fund a deposit. Pressing the ` +
      "button above sends both. They are worthless by design."
    : null;

  const serviceMeta = service
    ? `Billed by the second · ${ratePerSecond(service.rateAtomicPerSecond, decimals)} ${unit} per second`
    : "Billed by the second";

  return (
    <div className={styles.shell} id="top">
      <a className={styles.skipLink} href="#main-content">Skip to the UsageBar demo</a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.wordmark} href="#top" aria-label="UsageBar home">UsageBar</a>

          <nav className={styles.nav} aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#evidence">Proof</a>
            <a href="#about">About</a>
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
            ) : wallet.status === "connecting" ? (
              <>
                <span
                  className={`chip chip-accent ${styles.walletChip} ${styles.connectingStatus}`}
                  role="status"
                  aria-live="polite"
                  aria-label={`Connecting to ${wallet.name ?? "wallet"}`}
                  title={`Connecting to ${wallet.name ?? "wallet"}`}
                >
                  <span className={styles.connectingStatusDesktop}>Connecting to {wallet.name ?? "wallet"}…</span>
                  <span className={styles.connectingStatusMobile}>Connecting…</span>
                </span>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={actions.cancelConnect}
                  disabled={busy}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-quiet"
                onClick={showWalletPicker}
                disabled={busy}
              >
                Connect wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {walletPickerOpen && (
        <div
          className={styles.walletPickerBackdrop}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setWalletPickerOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setWalletPickerOpen(false);
          }}
        >
          <section
            className={styles.walletPicker}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-picker-title"
            aria-describedby="wallet-picker-description"
          >
            <div className={styles.walletPickerHeader}>
              <div>
                <p className="eyebrow">SOLANA DEVNET</p>
                <h2 id="wallet-picker-title">Connect a wallet</h2>
              </div>
              <button
                type="button"
                className={styles.walletPickerClose}
                onClick={() => setWalletPickerOpen(false)}
                aria-label="Close wallet selection"
              >
                ×
              </button>
            </div>
            <p id="wallet-picker-description" className={styles.walletPickerDescription}>
              Connect with a wallet you already use. UsageBar will request approval in that wallet;
              it never receives your recovery phrase or private key.
            </p>
            <div className={styles.walletOptions}>
              {walletOptions.map((option) => (
                <div className={styles.walletOption} data-wallet-id={option.id} key={option.id}>
                  <div className={styles.walletOptionCopy}>
                    <strong>{option.name}</strong>
                    <span>
                      {option.installed ? "Detected in this browser" : "Extension not detected"}
                    </span>
                  </div>
                  {option.installed ? (
                    <button
                      type="button"
                      className="button"
                      onClick={() => selectWallet(option.id)}
                    >
                      Connect
                    </button>
                  ) : (
                    <a
                      className={styles.walletInstallLink}
                      href={WALLET_DOWNLOAD_URLS[option.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Install ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
            <p className={styles.walletPickerNote}>
              Before opening a tab, set the selected wallet network to <strong>Devnet</strong>.
              Only test tokens are used; they have no real-world value.
            </p>
          </section>
        </div>
      )}

      <main className={styles.main} id="main-content">
        <section className={styles.proposition} aria-labelledby="hero-title">
            <div className={styles.kicker}>
              <span>THE OPEN TAB</span>
              <span className={styles.kickerRule} aria-hidden="true" />
            </div>

            <h1 className="display" id="hero-title" aria-label="Pay for what you actually use.">
              <span>Pay for what</span>
              {" "}
              <span>you actually use.</span>
            </h1>

            <p className={styles.lede}>
              <span>One approval sets a spending limit.</span>
              <span>Usage adds up while the service runs.</span>
              <span>Pay for what was used. Get the rest back.</span>
            </p>

            <ol className={styles.steps} aria-label="How UsageBar works">
              <li className={styles.step}>
                <svg className={styles.stepIcon} viewBox="0 0 48 48" aria-hidden="true">
                  <rect x="5" y="9" width="34" height="25" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M5 16H39" stroke="currentColor" strokeWidth="2" />
                  <circle cx="37" cy="35" r="9" fill="var(--accent)" />
                  <path d="M37 30V40M32 35H42" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <h2 className={styles.stepTitle}><span>1.</span> Open a tab</h2>
                <p>Approve a cap once. It is not the final charge.</p>
              </li>
              <li className={styles.step}>
                <svg className={styles.stepIcon} viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M7 38H42" stroke="currentColor" strokeWidth="2" />
                  <rect x="10" y="24" width="7" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="22" y="16" width="7" height="22" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="34" y="7" width="7" height="31" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <h2 className={styles.stepTitle}><span>2.</span> Use the service</h2>
                <p>The meter tracks time used in this demo.</p>
              </li>
              <li className={styles.step}>
                <svg className={styles.stepIcon} viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M12 7H36V39L31 35L24 40L17 35L12 39Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M18 16H30M18 22H30M18 28H27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <h2 className={styles.stepTitle}><span>3.</span> Settle once</h2>
                <p>Settle the measured amount; return the unused balance.</p>
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
            serviceName="Camera rental"
            serviceMeta={service ? `Usage-based billing · ${ratePerSecond(service.rateAtomicPerSecond, decimals)} TEST per second` : "Usage-based billing · billed by the second"}
            unitLabel={unit}
            ceiling={ceiling}
            settled={settled}
            decimals={decimals}
            provenance={hasChannel ? "ON_CHAIN" : "PROPOSED"}
            facts={facts}
            settlementProof={settlementProof}
            updates={updates}
            onOpen={onPrimary}
            onClose={actions.close}
            openLabel={openLabel}
            blockedReason={blockedReason}
          />
        </div>

    
      </main>

      <section className={styles.howSection} id="how" aria-labelledby="how-title">
        <div className={styles.howInner}>
          <p className="eyebrow">The idea is simple</p>
          <h2 className={styles.howTitle} id="how-title">One tab. Usage that adds up. One settlement.</h2>
          <div className={styles.howGrid}>
            <article className={styles.howStep}>
              <span className={styles.howIndex}>01</span>
              <h3>Open a tab</h3>
              <p>Approve a spending cap once. It is held in a Solana payment channel, not charged in full. The service can record many usage updates without an on-chain payment each time.</p>
            </article>
            <article className={styles.howStep}>
              <span className={styles.howIndex}>02</span>
              <h3>Use the service</h3>
              <p>Here, a simulated camera-rental timer measures seconds used. The same payment pattern can support metered API calls, AI inference, compute, or data delivery.</p>
            </article>
            <article className={styles.howStep}>
              <span className={styles.howIndex}>03</span>
              <h3>Close and settle</h3>
              <p>At close, the provider receives the recorded amount and the unused balance returns to the customer. You can inspect the result on Solana Devnet.</p>
            </article>
          </div>
        </div>
      </section>

      <footer className={styles.footer} id="about">
        <div className={styles.footerInner}>
          <div className={styles.footerHeader}>
            <div className={styles.footerHeadingGroup}>
              <p className={styles.footerEyebrow}>PROTOCOL EVIDENCE · SOLANA DEVNET</p>
              <h2 className={styles.footerTitle} id="evidence">Proof you can inspect.</h2>
              <p className={styles.footerIntro}>
                Four independently verifiable transactions demonstrate key Payment Channels operations. Each link opens
                the original transaction in Solana Explorer.
              </p>
            </div>
            <a className={styles.protocolLink}
              href="https://github.com/solana-foundation/payment-channels"
              target="_blank" rel="noopener noreferrer">
              Payment Channels source <span aria-hidden="true">↗</span>
            </a>
          </div>
          <ul className={styles.evidence} aria-label="Independent protocol verification transactions">
            {EVIDENCE.map((entry, index) => (
              <li className={styles.evidenceItem} key={entry.signature}>
                <span className={styles.evidenceIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.evidenceCopy}>
                  <span className={styles.evidenceClaim}>{entry.claim}</span>
                  <a className={styles.evidenceProof}
                    href={explorerTransactionUrl(entry.signature)}
                    target="_blank" rel="noopener noreferrer"
                    title={entry.signature}
                    aria-label={`Open transaction ${entry.signature} on Solana Explorer`}>
                    <span>{abbreviate(entry.signature, 9, 6)}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.footerBottom}>
            <p className={styles.footerNote}>
              These independent protocol-verification transactions cover different steps; they are not one transaction sequence or transactions from the tab above. A live session has its own proof. Camera usage is simulated. Payment-channel transactions are real
              on Devnet, but TEST tokens have no real-world value and this hackathon prototype has not been audited.
            </p>
            <nav className={styles.footerLinks} aria-label="Project details">
              <a href="https://github.com/Temmygabriel/UsageBar/blob/main/docs/CLAIM_STATUS.md" target="_blank" rel="noopener noreferrer">Claim status ↗</a>
              <a href="https://github.com/Temmygabriel/UsageBar/blob/main/docs/LIMITATIONS.md" target="_blank" rel="noopener noreferrer">Limitations ↗</a>
              <a href="https://github.com/Temmygabriel/UsageBar" target="_blank" rel="noopener noreferrer">Source code ↗</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
