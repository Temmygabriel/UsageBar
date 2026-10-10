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

/** A readable per-request price. This is copy, never settlement arithmetic. */
function ratePerRequest(atomicPerRequest: string, decimals: number): string {
  return (Number(atomicPerRequest) / 10 ** decimals).toFixed(2);
}

export default function Page() {
  const { state, actions } = useSession();
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [selectedCeiling, setSelectedCeiling] = useState("10");
  const { wallet, service, channel, facts, updates, notice, busy, balances, settlementProof, usageAmount, taskCount, lastExtraction } = state;

  const decimals = service?.decimals ?? 6;
  const unit = "TEST";

  const connected = wallet.status === "connected";
  const hasChannel = channel !== null;

  /** The chosen ceiling is user-controlled before opening, chain-read afterwards. */
  const scale = 10n ** BigInt(decimals);
  const configuredMaximum = BigInt(service?.ceilingAtomic ?? "50000000");
  const requestedCeiling = BigInt(selectedCeiling) * scale;
  const selectedCeilingAtomic = (requestedCeiling <= configuredMaximum ? requestedCeiling : configuredMaximum).toString();
  const ceiling = hasChannel ? BigInt(channel.deposit) : BigInt(selectedCeilingAtomic);
  const settled = usageAmount;
  const groqUnavailable = service !== null && !service.groqConfigured;

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
      : groqUnavailable
        ? "Groq API not configured"
        : "Authorize up to " + selectedCeiling + " TEST";

  const onPrimary = (capAtomic: string) => {
    if (!connected) {
      if (wallet.status === "connecting") actions.cancelConnect();
      else showWalletPicker();
      return;
    }
    if (shortOnFunds) {
      void actions.fund();
      return;
    }
    void actions.open(capAtomic);
  };

  const blockedReason = shortOnFunds
    ? `Your wallet needs Devnet SOL and ${unit} before it can fund a deposit. Pressing the button above sends both; they have no real-world value.`
    : groqUnavailable && connected
      ? "The Groq key is not configured in this deployment. Add GROQ_API_KEY in Vercel before opening a tab; no deposit will be requested."
      : null;

  const serviceMeta = service
    ? `${ratePerRequest(service.rateAtomicPerRequest, decimals)} TEST per successful Groq contract review`
    : "Real Groq AI review · priced per successful request";

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
                <span className={`chip chip-accent ${styles.walletChip}`} role="status" aria-live="polite">
                  Connecting to {wallet.name ?? "wallet"}…
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
              <span>METERED AI SERVICE</span>
              <span className={styles.kickerRule} aria-hidden="true" />
            </div>

            <h1 className="display" id="hero-title" aria-label="Pay for what you actually use.">
              <span>Pay for what</span>
              {" "}
              <span>you actually use.</span>
            </h1>

            <p className={styles.lede}>
              <span>One approval sets a spending limit.</span>
              <span>Each successful AI review adds one signed usage voucher.</span>
              <span>Pay for what was used. Get the rest back.</span>
            </p>

            <div className={styles.contractArt} aria-hidden="true">
              <svg viewBox="0 0 520 300" role="presentation">
                <path d="M155 43h210v230H155z" fill="var(--paper-raised)" stroke="var(--rule-strong)" strokeWidth="1.2" />
                <path d="M176 66h112" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
                <text x="176" y="89" fill="var(--ink-muted)" fontSize="9" letterSpacing="1.8" fontFamily="monospace">SERVICE AGREEMENT · 04</text>
                <text x="176" y="115" fill="var(--ink)" fontSize="19" fontFamily="Georgia, serif">Terms &amp; conditions</text>
                <path d="M176 139h164M176 150h150M176 161h165M176 181h153M176 192h164M176 203h120" stroke="var(--rule-strong)" strokeWidth="1.5" strokeLinecap="round" />
                <rect x="176" y="221" width="126" height="31" rx="2" fill="var(--accent-quiet)" stroke="var(--accent)" strokeWidth="1" />
                <path d="M190 237l5 5 10-12" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <text x="214" y="241" fill="var(--ink)" fontSize="9" letterSpacing="1" fontFamily="monospace">REVIEWED</text>
                <g transform="translate(330 145) rotate(5)">
                  <rect x="0" y="0" width="142" height="111" rx="2" fill="var(--paper)" stroke="var(--rule-strong)" strokeWidth="1.2" />
                  <text x="15" y="21" fill="var(--ink-muted)" fontSize="8" letterSpacing="1.2" fontFamily="monospace">AI REVIEW</text>
                  <path d="M15 35h111M15 45h98M15 55h108M15 65h88" stroke="var(--rule-strong)" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="28" cy="85" r="8" fill="var(--success-quiet)" stroke="var(--success)" />
                  <path d="M24 85l3 3 5-6" fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <text x="42" y="88" fill="var(--ink)" fontSize="8" letterSpacing=".7" fontFamily="monospace">CLAUSE CHECK</text>
                </g>
                <path d="M72 235h47M96 211v48" stroke="var(--accent)" strokeWidth="1.2" opacity=".5" />
                <circle cx="96" cy="235" r="15" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity=".65" />
                <circle cx="429" cy="57" r="21" fill="var(--success-quiet)" stroke="var(--success)" strokeWidth="1.2" />
                <path d="M420 57l6 6 12-14" fill="none" stroke="var(--success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

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
                <h2 className={styles.stepTitle}><span>2.</span> Review a contract</h2>
                <p>Each valid Groq result adds one signed usage voucher.</p>
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
            serviceName="Contract review"
            serviceMeta={serviceMeta}
            unitLabel={unit}
            ceiling={ceiling}
            settled={settled}
            decimals={decimals}
            provenance={hasChannel ? "ON_CHAIN" : "PROPOSED"}
            facts={facts}
            settlementProof={settlementProof}
            updates={updates}
            rateAtomicPerRequest={service?.rateAtomicPerRequest ?? "1000000"}
            groqConfigured={service?.groqConfigured ?? false}
            selectedCeiling={selectedCeiling}
            onCeilingChange={setSelectedCeiling}
            taskCount={taskCount}
            lastExtraction={lastExtraction}
            onOpen={onPrimary}
            onStartService={actions.startService}
            onRunUsage={actions.runUsage}
            busyRequest={busy}
            openDisabled={Boolean(connected && (!service || (!shortOnFunds && groqUnavailable)))}
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
              <p>Here, every successful Groq-powered contract review adds one provider-signed cumulative usage voucher off-chain. No settlement transaction is sent per review.</p>
            </article>
            <article className={styles.howStep}>
              <span className={styles.howIndex}>03</span>
              <h3>Close and settle</h3>
              <p>At close, UsageBar submits the latest cumulative voucher once, settles the tab, pays the provider, and returns unused TEST to the customer. You can inspect the resulting Solana Devnet transactions.</p>
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
