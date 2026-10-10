import type { CSSProperties } from "react";

import { formatAmount } from "../../lib/amounts";
import {
  type ChannelFacts,
  type ProductState,
  type UsageUpdate,
  type ValueProvenance,
  abbreviate,
  describeMeter,
  explorerAddressUrl,
  explorerTransactionUrl,
  lastConfirmedUpdate,
  meterFraction,
  unusedRemainder,
} from "../../lib/session";

import styles from "./UsageTab.module.css";

/**
 * The Usage Tab — the dominant object of the interface.
 *
 * Build spec Section 0C pins its contents: strong `USAGE TAB` label, service
 * identity, clearly separated amounts, a usage meter, session status, a usage
 * update count when real data exists, a dominant primary action, and a final
 * settlement area once the session is complete.
 *
 * The one rule this component exists to enforce: a number is only ever drawn
 * from `provenance`-labelled data, and a PROPOSED ceiling never wears the
 * verified treatment. `facts` is null until a channel actually exists on
 * chain, and the component says so rather than filling the space.
 *
 * It is presentational — every value and callback arrives as a prop. It has no
 * chain access and no state of its own, so it cannot invent a result.
 */

export interface UsageTabProps {
  readonly state: ProductState;
  readonly serviceName: string;
  readonly serviceMeta: string;
  readonly unitLabel: string;
  readonly ceiling: bigint;
  readonly settled: bigint;
  readonly decimals: number;
  readonly provenance: ValueProvenance;
  readonly facts: ChannelFacts | null;
  readonly updates: readonly UsageUpdate[];
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /**
   * The READY-state primary action's label.
   *
   * The next real step is not always "open a tab": with no wallet connected it
   * is "connect a wallet", and with an empty wallet it is "get test funds". The
   * label is a prop so the button can name the step that will actually happen
   * rather than the one the developer had in mind.
   */
  readonly openLabel?: string;
  /** Why the primary action is unavailable, if it is. Rendered under the button. */
  readonly blockedReason?: string | null;
}

/** The status chip. Each state gets a label and a tone, never a fake success. */
function statusChip(state: ProductState): { label: string; tone: string } {
  switch (state) {
    case "READY":
      return { label: "Not opened", tone: "" };
    case "OPENING":
      return { label: "Opening", tone: "chip-accent" };
    case "FUNDED":
      return { label: "Funded", tone: "chip-verified" };
    case "ACTIVE":
      return { label: "In use", tone: "chip-accent" };
    case "FINALIZING":
      return { label: "Settling", tone: "chip-accent" };
    case "SETTLED":
      return { label: "Settled", tone: "chip-verified" };
  }
}

export default function UsageTab({
  state,
  serviceName,
  serviceMeta,
  unitLabel,
  ceiling,
  settled,
  decimals,
  provenance,
  facts,
  updates,
  onOpen,
  onClose,
  openLabel = "Open tab",
  blockedReason = null,
}: UsageTabProps) {
  const chip = statusChip(state);
  const onChain = provenance === "ON_CHAIN";

  const remaining = ceiling > settled ? ceiling - settled : 0n;
  const health = describeMeter(settled, ceiling);
  const fraction = meterFraction(settled, ceiling);

  const confirmed = lastConfirmedUpdate(updates);
  const pendingCount = updates.filter((update) => update.signature === null).length;

  const meterFillClass = [
    styles.meterFill,
    health === "FULL" ? styles.meterFillFull : "",
    health === "INCONSISTENT" ? styles.meterFillInconsistent : "",
  ]
    .filter(Boolean)
    .join(" ");

  const amountClass = [styles.rowValue, onChain ? "" : styles.rowValueMuted]
    .filter(Boolean)
    .join(" ");

  // The primary action is single and dominant, per Section 0C. It is disabled
  // while a transaction is in flight so it cannot be double-submitted, and
  // absent once there is nothing left to do.
  const busy = state === "OPENING" || state === "FINALIZING";
  const canOpen = state === "READY";
  const canClose = state === "FUNDED" || state === "ACTIVE";

  return (
    <div className={styles.tabStack}>
    <article className={styles.tab} aria-label="Usage tab">
      <header className={styles.head}>
        <span className={styles.tabLabel}>Usage Tab</span>
        <span className={styles.tabNumber}>
          {facts !== null && onChain ? abbreviate(facts.address, 4, 4) : "PREVIEW"}
        </span>
      </header>

      <div className={styles.service}>
        <svg className={styles.cameraIcon} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M15 12 18 7h12l3 5h3a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3h3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="35" cy="17" r="1.5" fill="currentColor" />
        </svg>
        <div className={styles.serviceCopy}>
          <span className="eyebrow">DEMO SERVICE</span>
          <h2 className={styles.serviceName}>{serviceName}</h2>
          <p className={styles.serviceMeta}>{serviceMeta}</p>
          <p
            className={styles.serviceState}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className={[styles.stateDot, state === "SETTLED" ? styles.stateDotSuccess : ""].filter(Boolean).join(" ")} aria-hidden="true" />
            {state === "READY" ? "No active tab yet" : chip.label}
          </p>
        </div>
      </div>

      <div className={styles.amounts}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Authorized (max)</span>
          <span className={[amountClass, styles.rowValueCeiling].join(" ")}>
            {formatAmount(ceiling, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Used (so far)</span>
          <span className={amountClass}>
            {formatAmount(settled, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Remaining</span>
          <span className={amountClass}>
            {formatAmount(remaining, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>
      </div>

      <div className={styles.meter}>
        <div
          className={styles.meterTrack}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number((fraction * 100).toFixed(2))}
          aria-valuetext={`${formatAmount(settled, decimals)} ${unitLabel} used of ${formatAmount(ceiling, decimals)} ${unitLabel} authorized`}
          aria-label="Usage progress"
        >
          <div
            className={meterFillClass}
            style={{ "--meter-width": `${(fraction * 100).toFixed(2)}%` } as CSSProperties}
          />
        </div>

        <div className={styles.meterScale}>
          <span>{Math.round(fraction * 100)}% used · {confirmed !== null ? `${updates.filter((update) => update.signature !== null).length} signed updates` : "no usage recorded"}</span>
          <span>{formatAmount(settled, decimals)} / {formatAmount(ceiling, decimals)} {unitLabel}</span>
        </div>

        {health === "INCONSISTENT" && (
          <p className={styles.pending} style={{ marginTop: "var(--space-2)" }}>
            Settled exceeds the authorized ceiling, which the protocol rejects (error 235). This
            reading is wrong and is shown as wrong rather than drawn as a plausible bar.
          </p>
        )}
      </div>

      {onChain && facts !== null && (
        <div className={styles.proof}>
          <div className={styles.proofRow}>
            <span className={styles.proofLabel}>Channel</span>
            <a
              className={styles.proofValue}
              href={explorerAddressUrl(facts.address)}
              target="_blank"
              rel="noreferrer"
            >
              {abbreviate(facts.address)}
            </a>
          </div>
          <div className={styles.proofRow}>
            <span className={styles.proofLabel}>Opened by</span>
            <a
              className={styles.proofValue}
              href={explorerTransactionUrl(facts.openTransaction)}
              target="_blank"
              rel="noreferrer"
            >
              {abbreviate(facts.openTransaction, 12, 6)}
            </a>
          </div>
        </div>
      )}

      <section className={styles.settlement} aria-label="Final settlement">
        <header className={styles.settlementHead}>
          <h3 className={styles.settlementTitle}>Final settlement</h3>
          <span className={state === "SETTLED" && facts !== null ? styles.settlementDone : styles.settlementPending}>
            {state === "SETTLED" && facts !== null ? "Completed" : "After close"}
          </span>
        </header>

        <div className={styles.settlementGrid}>
          <div className={styles.settlementCell}>
            <span className={styles.settlementLabel}>Authorized</span>
            <strong className={styles.settlementValue}>
              {state === "SETTLED" && facts !== null ? formatAmount(facts.deposit, decimals) : "—"}
            </strong>
            <span className={styles.settlementHint}>{state === "SETTLED" ? "Deposit verified" : "Final chain state"}</span>
          </div>
          <div className={styles.settlementCell}>
            <span className={styles.settlementLabel}>Settled (used)</span>
            <strong className={styles.settlementValue}>
              {state === "SETTLED" && facts !== null ? formatAmount(facts.settled, decimals) : "—"}
            </strong>
            <span className={styles.settlementHint}>{state === "SETTLED" ? "Provider amount" : "Confirmed at close"}</span>
          </div>
          <div className={styles.settlementCell}>
            <span className={styles.settlementLabel}>Returned (unused)</span>
            <strong className={styles.settlementValue}>
              {state === "SETTLED" && facts !== null ? formatAmount(unusedRemainder(facts), decimals) : "—"}
            </strong>
            <span className={styles.settlementHint}>{state === "SETTLED" ? "Refund verified" : "Verified refund"}</span>
          </div>
        </div>
        <p className={styles.settlementNote}>
          {state === "SETTLED" && facts !== null
            ? "Only the amount you used was charged. The rest was returned."
            : "Settlement amounts appear here after the close is verified on-chain."}
        </p>
      </section>

      <footer className={styles.foot}>
        {canOpen && (
          <>
            <button type="button" className="button button-block" onClick={onOpen}>
              <span>{openLabel}</span><span className={styles.buttonArrow} aria-hidden="true">→</span>
            </button>
            {blockedReason !== null && <p className={styles.pending}>{blockedReason}</p>}
          </>
        )}

        {canClose && (
          <button type="button" className="button button-block" onClick={onClose}>
            <span>Close &amp; settle</span><span className={styles.buttonArrow} aria-hidden="true">→</span>
          </button>
        )}

        {busy && (
          <button type="button" className="button button-block" disabled>
            {state === "OPENING" ? "Opening…" : "Settling…"}
          </button>
        )}

        {!onChain && (
          <p className={styles.notice}>
            No deposit is made until you approve the opening transaction. Camera usage is simulated;
            the payment channel is real on Solana Devnet. TEST tokens have no real-world value.
          </p>
        )}

        {state === "SETTLED" && (
          <p className={styles.settledMessage} role="status">
            <span className="chip-dot" /> Settled on chain — nothing further is owed.
          </p>
        )}

        <div className={styles.networkNote}>
          <span className={styles.networkDot} aria-hidden="true" />
          <span>SOLANA DEVNET · TEST FUNDS ONLY</span>
        </div>
      </footer>
    </article>
    </div>
  );
}
