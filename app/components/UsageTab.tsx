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
    <article className={styles.tab} aria-label="Usage tab">
      <header className={styles.head}>
        <span className={styles.tabLabel}>Usage Tab</span>
        <span className={["chip", chip.tone].filter(Boolean).join(" ")}>
          {chip.tone === "chip-verified" && <span className="chip-dot" />}
          {chip.label}
        </span>
      </header>

      <div className={styles.perforation} role="presentation" />

      <div className={styles.service}>
        <span className="eyebrow">Service</span>
        <h2 className={styles.serviceName}>{serviceName}</h2>
        <p className={styles.serviceMeta}>{serviceMeta}</p>
      </div>

      <div className={styles.amounts}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Authorized</span>
          <span className={[amountClass, styles.rowValueCeiling].join(" ")}>
            {formatAmount(ceiling, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Used</span>
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
          aria-valuemax={Number(ceiling)}
          aria-valuenow={Number(settled)}
          aria-label={`Usage: ${formatAmount(settled, decimals)} of ${formatAmount(ceiling, decimals)} ${unitLabel}`}
        >
          <div
            className={meterFillClass}
            style={{ "--meter-width": `${(fraction * 100).toFixed(2)}%` } as CSSProperties}
          />
        </div>

        <div className={styles.meterScale}>
          <span>{Math.round(fraction * 100)}% used</span>
          <span>
            {formatAmount(settled, decimals)} / {formatAmount(ceiling, decimals)}
          </span>
        </div>

        {health === "INCONSISTENT" && (
          <p className={styles.pending} style={{ marginTop: "var(--space-2)" }}>
            Settled exceeds the authorized ceiling, which the protocol rejects (error 235). This
            reading is wrong and is shown as wrong rather than drawn as a plausible bar.
          </p>
        )}
      </div>

      {!onChain && (
        <p className={styles.notice}>
          <strong>Nothing on chain yet.</strong> The ceiling above is the amount you are about to
          authorize. It is not a deposit, and no channel exists until the opening transaction is
          confirmed and read back from Solana.
        </p>
      )}

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

      {state === "SETTLED" && facts !== null && (
        <section className={styles.settlement} aria-label="Final settlement">
          <h3 className={styles.settlementTitle}>Final settlement</h3>

          <div className={styles.settlementRow}>
            <span className={styles.settlementLabel}>Authorized</span>
            <span className={styles.settlementValue}>
              {formatAmount(facts.deposit, decimals)}
            </span>
          </div>
          <div className={styles.settlementRow}>
            <span className={styles.settlementLabel}>Used</span>
            <span className={styles.settlementValue}>
              {formatAmount(facts.settled, decimals)}
            </span>
          </div>
          <div className={styles.settlementRow}>
            <span className={styles.settlementLabel}>Returned</span>
            <span className={styles.settlementValue}>
              {formatAmount(unusedRemainder(facts), decimals)}
            </span>
          </div>
        </section>
      )}

      <footer className={styles.foot}>
        {confirmed !== null || pendingCount > 0 ? (
          <p className={styles.updates}>
            <span className={styles.updatesCount}>
              {updates.filter((update) => update.signature !== null).length}
            </span>
            <span>signed usage update{updates.length === 1 ? "" : "s"}</span>
            {pendingCount > 0 && <span className={styles.pending}>· {pendingCount} pending</span>}
          </p>
        ) : (
          <p className={styles.updates}>
            <span>No usage recorded</span>
          </p>
        )}

        {canOpen && (
          <button type="button" className="button button-block" onClick={onOpen}>
            Open tab
          </button>
        )}

        {canClose && (
          <button type="button" className="button button-block" onClick={onClose}>
            Close &amp; settle
          </button>
        )}

        {busy && (
          <button type="button" className="button button-block" disabled>
            {state === "OPENING" ? "Opening…" : "Settling…"}
          </button>
        )}

        {state === "SETTLED" && (
          <p className={styles.updates} style={{ color: "var(--success)" }}>
            <span className="chip-dot" />
            <span>Settled on chain — nothing further is owed.</span>
          </p>
        )}
      </footer>
    </article>
  );
}
