# Free Render fallback deployment

## Why this exists

The Vercel deployment for the 11 October 2026 repeated-session and silent-wallet-reconnect changes was rate-limited with a message to retry in 24 hours. That extends beyond the 12 October hackathon deadline. This is an optional, zero-cost fallback host so the updated source can be demonstrated without waiting for that Vercel cooldown.

The fallback is **not live just because this file exists**. A service must be created in the Render dashboard, its five secrets entered privately, and its deployment verified.

## Create the service

1. Open <https://dashboard.render.com/> and sign in or create a free account with GitHub.
2. Choose **New → Blueprint** and connect the public repository <https://github.com/Temmygabriel/UsageBar>, branch `main`.
3. Render reads the root `render.yaml` and asks for the values marked `sync: false`. Set the five variables below from your existing Vercel project settings.
4. Choose the **Free** service plan and deploy. The build runs in Render's cloud; nothing needs to be installed on the Windows PC.
5. Wait until Render reports the deploy as live, open the generated `onrender.com` URL, and check that the page loads and the runtime says the chain, meter store and Groq service are configured. Then perform the full Devnet browser walkthrough before presenting it as working.

## Required private environment variables

Copy the **values** directly from the project's Vercel environment settings into Render's environment settings. Do not put the values in GitHub, this document, a demo script, or chat.

- `DEVNET_PAYER_KEYPAIR`
- `DEVNET_OPERATOR_KEYPAIR`
- `GROQ_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Only values from the existing Devnet deployment belong here. Do not substitute Mainnet keypairs. The remaining configuration has safe defaults in the repository.

## Important free-tier limitation

Render free web services spin down after 15 minutes without incoming traffic and typically need about one minute to wake on the next request. Open and warm the site immediately before a recording or live judging session. This fallback is for hackathon demo and testing, not production billing infrastructure. See [Render's current free-instance limitations](https://render.com/docs/free).

## Release gate

Do not call the new flow deployed until all of these are true: Render reports a live deployment; the public URL shows the updated commit; a real Devnet wallet can approve the deposit; two real AI reviews are metered; close and settle complete; **Authorize another tab** opens a second tab without refresh; and reload restores the previously selected wallet where its extension supports silent reconnect.
