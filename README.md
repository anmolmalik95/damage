# damage

> Split the bill. No ambiguity.

Live at **[damage.malik.codes](https://damage.malik.codes)**.

A bill-splitting app for groups that go out and forget who ordered what. Snap photos of the receipts, an AI parses them into line items, everyone claims what they had, and the app works out who owes whom — including shared dishes, who paid for which venue, and cross-session reconciliation when overlapping people have been splitting tabs over multiple nights.

## What it does

- **Receipt OCR.** Upload one or more receipt photos per venue; GPT-4o parses items, prices, GST, and service charge, and self-corrects when line items don't sum to the printed subtotal.
- **Sessions.** A session is one outing. Add venues (restaurants, bars, cabs), invite people with a shareable link.
- **Claiming.** Each person picks the items they ordered. Items can be shared between any subset of members (e.g. a bottle of wine for the table). Cab fares can be split the same way.
- **Settle up.** Track who paid each venue's bill; the breakdown computes who owes whom, with optional per-bill-payer payment instructions.
- **Multi-session reconcile.** Select several past sessions, merge people across them (handles inconsistent name spellings via fuzzy clustering), and get one consolidated debt graph for the whole trip.
- **Admin view.** Browse, lock, close, or delete sessions at `/admin`.

## Stack

- **Frontend:** React 19, Vite 8, React Router 7, framer-motion
- **Data:** Firebase Firestore (sessions, members, venues, items, claims) and Firebase Storage (receipt photos)
- **Receipt parsing:** OpenAI GPT-4o, exposed via `api/parse-receipt.js` as a Vercel serverless function in prod and a local Express server (`server.js`) in dev
- **Hosting:** Vercel for the frontend and API routes; Firebase project for data/storage

## Local development

Requires Node 18+, a Firebase project, and an OpenAI API key.

```bash
npm install
```

Create `.env.local` in the project root:

```
OPENAI_API_KEY=sk-...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ADMIN_PASSWORD=...    # gates /admin
```

Then:

```bash
npm run dev      # Vite on :5173 + Express receipt-parser on :3001
npm run lint     # ESLint
npm run build    # production bundle in dist/
```

## Deployment

Frontend and `/api/parse-receipt` deploy to Vercel from `main`. Firebase Storage CORS rules live in `cors.json` and are applied with:

```bash
gsutil cors set cors.json gs://<your-bucket>
```
