# Vercel and Firebase setup for `hb-avalia2`

Vercel (`https://hbavalia.vercel.app`) is the official deployment platform for HB Avalia. The app runs against the Firebase project `hb-avalia2`; the Netlify site is only kept until the Vercel cron is validated.

## Firebase project

1. Project `hb-avalia2` uses Email/Password Authentication, the Web App, and the `(default)` Firestore database in `southamerica-east1`.
2. Firestore rules and indexes live in `firestore.rules` and `firestore.indexes.json`. Always pass `--project hb-avalia2` explicitly (`.firebaserc` may still point to the old project), and verify the selected project before applying rules or indexes.
3. The app tenant ID is `hb-avalia`, configured through `NEXT_PUBLIC_DEFAULT_COMPANY_ID`. This is separate from the Firebase project ID `hb-avalia2`.
4. Authorized domains in Firebase Authentication must include `localhost`, `hb-avalia2.firebaseapp.com`, `hb-avalia2.web.app`, and `hbavalia.vercel.app`.

## Vercel project and environment

1. The project is `hbavalia` under the `ti-baratao` team. It builds with `npm run build` and detects Next.js automatically; `vercel.json` also points it to the `gru1` region.
2. Production environment variables:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `hb-avalia2`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
   - `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (optional)
   - `NEXT_PUBLIC_DEFAULT_COMPANY_ID` = `hb-avalia`
   - `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` = `false`
   - `FIREBASE_PROJECT_ID` = `hb-avalia2`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the complete service-account JSON for `hb-avalia2` (secret)
   - `CRON_SECRET` = a random secret used only by the scheduled checklist endpoint (secret)
3. The Firebase web configuration is public client configuration. The service account and `CRON_SECRET` are secrets; never commit them, paste them in chat, or give them a `NEXT_PUBLIC_` name.
4. Keep `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` unset or `false` in deploy contexts. Restrict secrets to production.

Server routes verify Firebase ID tokens and write with the Firebase Admin SDK. Evaluation submissions and survey responses use `POST /api/evaluations` and `POST /api/surveys/responses`; Promotion/PDI uses the `/api/promotion-requests` routes. The browser never receives Admin credentials.

## Scheduled checklist publication

`/api/cron/publish-scheduled-checklists` replaces the previous Netlify scheduled function. It runs on the Node.js runtime and reuses `functions/scheduled-checklists-core.js`, keeping the daily, weekly, and monthly recurrence rules and idempotent assignment IDs.

`vercel.json` registers the schedule `5 3 * * *` (UTC), which is `00:05` in `America/Sao_Paulo`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically; the route returns `401` when the header does not match and `500` when `CRON_SECRET` is not configured. On the Hobby plan the job may start at any time within the scheduled hour.

The job uses a collection-group query over `checklistTemplates` filtered by `scheduleEnabled`. Its collection-group index is declared in `firestore.indexes.json` and must be `READY` in `hb-avalia2`; without it the job fails with `FAILED_PRECONDITION` and publishes nothing.

`maxDuration` is 60 seconds. The job processes templates and recipients sequentially; if the number of scheduled assignments grows enough to approach that limit, it will need bounded batching.

## Verification

After each deployment:

1. `GET /api/cron/publish-scheduled-checklists` without a header returns `401`.
2. `GET` with `Authorization: Bearer $CRON_SECRET` returns `200` and logs the processed templates.
3. The cron appears in the Vercel project's Cron Jobs dashboard.
4. A repeat invocation does not duplicate assignments.
5. Sign in with the admin account, check the main tabs, run one evaluation and one survey, and test the password reset flow.
6. Confirm the app uses project `hb-avalia2`; never test against or publish to `hb-avalia`.
