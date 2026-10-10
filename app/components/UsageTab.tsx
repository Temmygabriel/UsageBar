import { useState, type CSSProperties } from "react";
import type { ExtractionResult } from "../../lib/client-api";

import { formatAmount } from "../../lib/amounts";
import {
  type ChannelFacts,
  type ProductState,
  type SettlementProof,
  type UsageUpdate,
  type ValueProvenance,
  abbreviate,
  describeMeter,
  explorerAddressUrl,
  explorerTransactionUrl,
  lastSignedUpdate,
  meterFraction,
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
  readonly settlementProof: SettlementProof | null;
  readonly updates: readonly UsageUpdate[];
  readonly rateAtomicPerRequest: string;
  readonly groqConfigured: boolean;
  readonly selectedCeiling: string;
  readonly onCeilingChange: (value: string) => void;
  readonly taskCount: number;
  readonly lastExtraction: ExtractionResult | null;
  readonly onOpen: (ceilingAtomic: string) => void;
  readonly onStartService: () => void;
  readonly onRunUsage: (documentText: string) => void;
  readonly busyRequest: boolean;
  readonly openDisabled?: boolean;
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
  settlementProof,
  updates,
  rateAtomicPerRequest,
  groqConfigured,
  selectedCeiling,
  onCeilingChange,
  taskCount,
  lastExtraction,
  onOpen,
  onStartService,
  onRunUsage,
  busyRequest,
  openDisabled = false,
  onClose,
  openLabel = "Open tab",
  blockedReason = null,
}: UsageTabProps) {
  const chip = statusChip(state);
  const [documentText, setDocumentText] = useState("SERVICE AGREEMENT\n\nThis Agreement is entered into on 15 October 2026 between Northstar Studio (the Client) and A. Okafor (the Consultant). The Consultant will deliver a website redesign and source files by 30 November 2026. The Client will pay NGN 850,000: 40% on commencement and 60% after acceptance. Either party may terminate this Agreement with 14 days written notice. The Consultant must keep business information confidential for two years. The Client owns the final deliverables after full payment, but third-party assets remain under their original licences. Late delivery may extend the deadline only where both parties agree in writing. The agreement does not state a dispute-resolution process, a limitation of liability, or what happens if acceptance feedback is delayed.");
  const onChain = provenance === "ON_CHAIN";

  const remaining = ceiling > settled ? ceiling - settled : 0n;
  const displayedRemainder = state === "SETTLED" && settlementProof !== null ? settlementProof.returnedToPayer : remaining;
  const health = describeMeter(settled, ceiling);
  const fraction = meterFraction(settled, ceiling);

  const latestVoucher = lastSignedUpdate(updates);

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
  // A signed voucher is not yet a chain-settled balance; keep its amount visually muted until close is verified.
  const usageAmountClass = [styles.rowValue, state === "SETTLED" ? "" : styles.rowValueMuted].filter(Boolean).join(" ");

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
          <path d="M13 6h16l8 8v28H13z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M29 6v9h8M19 23h12M19 29h12M19 35h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

      {state === "READY" && (
        <section className={styles.capPicker} aria-label="Authorize a spending maximum">
          <label className={styles.capLabel} htmlFor="usagebar-cap">AUTHORIZE A MAXIMUM</label>
          <div className={styles.capSelectRow}>
            <select id="usagebar-cap" className={styles.capSelect} value={selectedCeiling} onChange={(event) => onCeilingChange(event.target.value)}>
              <option value="5">5.00 TEST maximum</option>
              <option value="10">10.00 TEST maximum</option>
              <option value="25">25.00 TEST maximum</option>
              <option value="50">50.00 TEST maximum</option>
            </select>
            <span className={styles.capExplain}>Held in escrow · not charged in full</span>
          </div>
          <p className={styles.capHint}>Choose the most you are willing to spend. Only successful AI reviews increase the final bill.</p>
        </section>
      )}

      <div className={styles.amounts}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{onChain ? "Spending cap (authorized)" : "Spending cap (preview)"}</span>
          <span className={[amountClass, styles.rowValueCeiling].join(" ")}>
            {formatAmount(ceiling, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{state === "SETTLED" ? "Settled (used)" : state === "ACTIVE" && taskCount > 0 ? "Used (off-chain vouchers)" : "Used (so far)"}</span>
          <span className={usageAmountClass}>
            {formatAmount(settled, decimals)}
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{state === "SETTLED" ? "Returned (unused)" : onChain ? "Unspent cap (not refunded yet)" : "Not committed"}</span>
          <span className={amountClass}>
            {formatAmount(displayedRemainder, decimals)}
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
          <span>{Math.round(fraction * 100)}% of cap used · {taskCount} completed {taskCount === 1 ? "review" : "reviews"}</span>
          <span>{formatAmount(settled, decimals)} / {formatAmount(ceiling, decimals)} {unitLabel}</span>
        </div>

        {health === "INCONSISTENT" && (
          <p className={styles.pending} style={{ marginTop: "var(--space-2)" }}>
            Settled exceeds the authorized ceiling, which the protocol rejects (error 235). This
            reading is wrong and is shown as wrong rather than drawn as a plausible bar.
          </p>
        )}
      </div>




      <section className={styles.serviceControls} aria-label="Contract review service">
        {state === "FUNDED" && (
          <div className={styles.serviceReady}>
            <span className={styles.controlEyebrow}>READY TO USE</span>
            <h3>Your spending cap is funded.</h3>
            <p>Nothing has been billed yet. Start the service, then review sample contract text below. Each successful review costs {formatAmount(BigInt(rateAtomicPerRequest), decimals)} {unitLabel}.</p>
            {!groqConfigured && <p className={styles.pending}>Configure GROQ_API_KEY in Vercel and redeploy before starting the service.</p>}
            <button type="button" className="button button-block" onClick={onStartService} disabled={busyRequest || !groqConfigured}>Start contract review</button>
          </div>
        )}
        {state === "ACTIVE" && (
          <div className={styles.reviewForm}>
            <div className={styles.reviewFormHead}>
              <div><span className={styles.controlEyebrow}>METERED SERVICE</span><h3>Review a contract</h3></div>
              <span className={styles.unitPrice}>{formatAmount(BigInt(rateAtomicPerRequest), decimals)} {unitLabel} / review</span>
            </div>
            <label className={styles.capLabel} htmlFor="contract-input">SAMPLE CONTRACT TEXT</label>
            <textarea id="contract-input" className={styles.documentInput} value={documentText} onChange={(event) => setDocumentText(event.target.value)} maxLength={12000} rows={8} placeholder="Paste sample contract text. Do not paste confidential documents." />
            <div className={styles.reviewFooter}>
              <span>{documentText.trim().length.toLocaleString()} / 12,000 characters</span>
              <button type="button" className="button" onClick={() => onRunUsage(documentText)} disabled={!groqConfigured || busyRequest || documentText.trim().length < 80 || settled + BigInt(rateAtomicPerRequest) > ceiling}>
                {busyRequest ? "Reviewing…" : "Run AI review · " + formatAmount(BigInt(rateAtomicPerRequest), decimals) + " TEST"}
              </button>
            </div>
            {!groqConfigured && <p className={styles.pending}>Groq API key is not available to this deployment. Add GROQ_API_KEY in Vercel and redeploy before opening a paid tab.</p>}
            {settled + BigInt(rateAtomicPerRequest) > ceiling && <p className={styles.pending}>The next review would exceed the cap. Close and settle to return the unused balance.</p>}
            <p className={styles.offchainNote}>Successful requests add a provider-signed voucher off-chain. No blockchain transaction is sent per review; the latest voucher is submitted when you close.</p>
          </div>
        )}
        {lastExtraction !== null && (
          <article className={styles.reviewResult} aria-live="polite">
            <header><span className={styles.controlEyebrow}>LATEST AI RESULT · REVIEW {taskCount}</span><span className={styles.resultType}>{lastExtraction.documentType}</span></header>
            <p className={styles.resultSummary}>{lastExtraction.summary}</p>
            {lastExtraction.risks.length > 0 && <div className={styles.resultGroup}><h4>Potential issues to check</h4><ul>{lastExtraction.risks.map((risk, i) => <li key={"risk-" + i}>{risk}</li>)}</ul></div>}
            <div className={styles.resultColumns}>
              <div className={styles.resultGroup}><h4>Parties and dates</h4><ul>{[...lastExtraction.parties, ...lastExtraction.dates].length ? [...lastExtraction.parties, ...lastExtraction.dates].map((x, i) => <li key={"fact-" + i}>{x}</li>) : <li>Not stated</li>}</ul></div>
              <div className={styles.resultGroup}><h4>Payment terms</h4><ul>{lastExtraction.monetaryTerms.length ? lastExtraction.monetaryTerms.map((x, i) => <li key={"money-" + i}>{x}</li>) : <li>Not stated</li>}</ul></div>
            </div>
            {lastExtraction.clauses.length > 0 && <div className={styles.resultGroup}><h4>Key clauses</h4><ul>{lastExtraction.clauses.map((x, i) => <li key={"clause-" + i}>{x}</li>)}</ul></div>}
            {lastExtraction.missingDetails.length > 0 && <div className={styles.resultGroup}><h4>Missing or unclear</h4><ul>{lastExtraction.missingDetails.map((x, i) => <li key={"missing-" + i}>{x}</li>)}</ul></div>}
            <p className={styles.resultDisclaimer}>{lastExtraction.disclaimer} AI output can be wrong; verify against the source document.</p>
          </article>
        )}
      </section>

      <footer className={styles.foot}>
        {canOpen && (
          <>
            <button type="button" className="button button-block" onClick={() => onOpen((BigInt(selectedCeiling) * (10n ** BigInt(decimals))).toString())} disabled={openDisabled || busyRequest}>
              <span>{openLabel}</span><span className={styles.buttonArrow} aria-hidden="true">→</span>
            </button>
            {blockedReason !== null && <p className={styles.pending}>{blockedReason}</p>}
          </>
        )}

        {canClose && (
          <button type="button" className="button button-block" onClick={onClose} disabled={busyRequest || busy}>
            <span>Close &amp; settle</span><span className={styles.buttonArrow} aria-hidden="true">→</span>
          </button>
        )}

        {busy && (
          <button type="button" className="button button-block" disabled>
            {state === "OPENING" ? "Opening…" : "Settling…"}
          </button>
        )}

        <p className={styles.notice}>Groq supplies real AI review. Cumulative voucher updates stay off-chain until close; settlement transactions are real on Solana Devnet. TEST tokens have no real-world value. Use sample or public text only, never confidential agreements.</p>

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

      {state === "SETTLED" && facts !== null && (
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
            <span className={styles.settlementHint}>{state === "SETTLED" && settlementProof !== null ? `${formatAmount(settlementProof.paidToProvider, decimals)} ${unitLabel} paid to provider` : "Confirmed at close"}</span>
          </div>
          <div className={styles.settlementCell}>
            <span className={styles.settlementLabel}>Returned (unused)</span>
            <strong className={styles.settlementValue}>
              {state === "SETTLED" && settlementProof !== null ? formatAmount(settlementProof.returnedToPayer, decimals) : "—"}
            </strong>
            <span className={styles.settlementHint}>{state === "SETTLED" && settlementProof !== null ? "Returned on chain" : "Verified refund"}</span>
          </div>
        </div>
        <p className={styles.settlementNote}>
          {state === "SETTLED" && facts !== null
            ? "Only the amount you used was charged. The rest was returned."
            : "Settlement amounts appear here after the close is verified on-chain."}
        </p>
        </section>
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
          {latestVoucher !== null && (
            <div className={styles.proofRow}>
              <span className={styles.proofLabel}>Latest off-chain voucher</span>
              <span className={styles.proofValue} title={latestVoucher.voucherSignature}>{abbreviate(latestVoucher.voucherSignature, 9, 6)}</span>
            </div>
          )}
          {settlementProof !== null && (
            <>
              <div className={styles.proofRow}>
                <span className={styles.proofLabel}>Seal &amp; settle</span>
                <a className={styles.proofValue}
                  href={explorerTransactionUrl(settlementProof.sealSignature)}
                  target="_blank" rel="noopener noreferrer"
                  title={settlementProof.sealSignature}>
                  {abbreviate(settlementProof.sealSignature, 9, 6)}
                </a>
              </div>
              <div className={styles.proofRow}>
                <span className={styles.proofLabel}>Distribution &amp; refund</span>
                <a className={styles.proofValue}
                  href={explorerTransactionUrl(settlementProof.distributeSignature)}
                  target="_blank" rel="noopener noreferrer"
                  title={settlementProof.distributeSignature}>
                  {abbreviate(settlementProof.distributeSignature, 9, 6)}
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
