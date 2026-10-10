# First-Viewport Test

**Build spec Section 64.**

> Before final UI freeze: ask a stranger the five questions below. Pass target:
> product recognized within about 5 seconds; core flow understood within about
> 30 seconds. Do not manufacture positive answers.

## Status: NOT RUN

This file is a scaffold, not a record. **No results are filled in below,
because nobody has been asked yet.** The empty cells are the honest state of
this document — filling them in from imagination is the one thing Section 64
explicitly forbids, and it is the failure mode this whole repository is built to
avoid.

It exists now rather than at the end for two reasons: the questions are fixed by
the spec and worth reading before the interface freezes, and an absent file
would read as "not required" instead of "not done".

---

## How to run it

**Who.** Someone who has not seen this project, has not read this repository,
and does not work on crypto. A friend, a flatmate, a colleague from an unrelated
team. The test is worthless if the person already knows what a payment channel
is — the entire question is whether the interface explains itself to someone who
does not.

**What.** Sit them in front of <https://usagebar.vercel.app> and say nothing
else. Do not explain the product, do not point at anything, do not answer
questions until all five are asked and answered. If they ask what to do, write
down that they asked rather than answering.

**When to record.** Immediately, not from memory afterwards. Their first answer
is the data; a corrected one is not.

**Timing.** Record how long until they say something that identifies the
product, and how long until they can describe the flow. "About 5 seconds" typed
after the fact is not a measurement — use a stopwatch or a phone.

**Then the second pass.** Section 65 asks for the anti-AI test on top of this:
cover the logo and the product name, and check whether the payment tab, the
contract-review form, the selectable spending cap, the **Used / Unspent cap**
figures, the off-chain voucher explanation, and **Close & settle** still read as what they are. A judge arriving cold
sees the same thing, minus anything you explained.

The interface's own labels are worth knowing before running this, because they
are what the questions below are really testing:

| State | Labels shown |
|---|---|
| Before opening | `Spending cap (preview)` · `Used (so far)` · `Not committed` |
| During a session | `Spending cap (authorized)` · `Used (off-chain vouchers)` · `Unspent cap (not refunded yet)` |
| After close | `Authorized` · `Used` · `Returned` |
| Service action | `Start contract review` · `Run AI review · 1.00 TEST` |
| Close action | `Close & settle` |

---

## The five questions

Filled in exactly as the spec asks them. **Answers go in the table below each
question, verbatim where possible.**

### 1. What is this?

| | |
|---|---|
| Answer (verbatim) | |
| Time to answer | |
| Did they name the product? | |

### 2. What is the customer paying for?

The expected product answer is one Groq-powered contract review per successful request, priced at 1.00 TEST for the demo. Do not explain this before the participant answers.

| | |
|---|---|
| Answer (verbatim) | |
| Time to answer | |

### 3. What does the selected cap represent?

The participant sees a selectable cap (5, 10, 25, or 50 TEST), not a fixed 50.00.

| | |
|---|---|
| Answer (verbatim) | |
| Did they describe it as a maximum/ceiling rather than a charge? | |

### 4. What event increases the "used" amount?

| | |
|---|---|
| Answer (verbatim) | |
| Did they connect it to a successful AI review rather than elapsed time or a flat fee? | |

### 5. What happens when I press "Close & settle"?

| | |
|---|---|
| Answer (verbatim) | |
| Did they expect the unused remainder back? | |

---

## Results

| Question | Pass? | Notes |
|---|---|---|
| 1 — what is this | _not run_ | |
| 2 — what is paid for | _not run_ | |
| 3 — the selected cap | _not run_ | |
| 4 — "used" | _not run_ | |
| 5 — closing the tab | _not run_ | |

| Target | Result |
|---|---|
| Product recognized within ~5 seconds | _not run_ |
| Core flow understood within ~30 seconds | _not run_ |

| Participant | |
|---|---|
| Who they are (role, not name) | |
| Prior crypto knowledge | |
| Date | |
| Ran against commit | |

---

## What a failure here would mean

Worth writing down before running it, so a bad result is not explained away
afterwards.

- **Failing question 1** means the landing screen is describing the mechanism
  rather than the product. The mechanism is the interesting part to us and the
  irrelevant part to a customer.
- **Failing question 3** is the most serious of the five. If the ceiling does
  not read as a ceiling, the product's entire promise — a defined maximum
  exposure — has not landed, and the interface is showing a number without
  saying what it bounds.
- **Failing question 5** is a product failure rather than a copy failure. The
  return of the unused remainder is the reason the tab model works at all; a
  customer who does not expect it back will not open the tab.

A partial pass is still useful. Section 64 asks for about 5 and about 30
seconds, not for perfection, and a question that needed a follow-up is worth
more in this file than a question that was quietly helped along.

---

## Related

- [`CLAIM_STATUS.md`](CLAIM_STATUS.md) — what is proven about the protocol and
  the deployment, and what is not
- [`SUBMISSION.md`](SUBMISSION.md) — the honest-limitations section, which is
  where an unrun UX test is already listed
