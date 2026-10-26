# Netlify and Firebase setup for the fresh `hb-avalia2` project

This setup starts with an empty Firebase project. It does not copy users, UIDs, Firestore documents, or history from `hb-avalia`; that source project remains untouched. Everyone must create a new account in `hb-avalia2`.

## Firebase destination

1. In Firebase Console, select project `hb-avalia2`, enable Email/Password Authentication, create a Web App, and create the `(default)` Firestore database in `southamerica-east1`.
2. Configure the Firestore rules and indexes from `firestore.rules` and `firestore.indexes.json`. The repository `.firebaserc` still defaults to the old `hb-avalia` project, so never rely on its default. If using Firebase CLI, pass `--project hb-avalia2` explicitly and verify the selected project before applying rules or indexes. Do not run the `deploy:firebase` script; it targets the old project.
3. The initial account can create the app's tenant with ID `hb-avalia` and becomes its administrator. This tenant ID is separate from the Firebase project ID `hb-avalia2`.

## Netlify site and environment

1. Import this GitHub repository as a Netlify site. Use `npm run build` and allow Netlify to detect the Next.js framework. `netlify.toml` selects Node.js 24 for the build and `nodejs24.x` for the function runtime. Do not configure `.next` as a static-only publish directory.
2. Set these variables in Netlify. The Firebase web configuration values are public client configuration; the service-account JSON is secret and must never use a `NEXT_PUBLIC_` name.
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `hb-avalia2`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
   - `NEXT_PUBLIC_DEFAULT_COMPANY_ID` = `hb-avalia` (the app tenant ID)
   - `FIREBASE_PROJECT_ID` = `hb-avalia2`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the complete service-account JSON for the destination project
3. Create a dedicated service account for the server-side operations. Grant only the Firestore permissions and Firebase Authentication token-verification/revocation permissions the app needs. Store its key directly in Netlify's secret environment-variable settings; do not send it in chat, commit it, or put it in `.env.example`.
4. Leave `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` unset or `false` in deploy contexts. Restrict secrets to production (and only previews that are explicitly meant to access the destination data).
5. Configure Authentication's authorized domains for the Netlify site before testing sign-in.

The app's server routes verify Firebase ID tokens and write with Firebase Admin. Evaluation submissions and survey responses now use `POST /api/evaluations` and `POST /api/surveys/responses`; Promotion/PDI uses the existing `/api/promotion-requests` routes. The browser does not receive Admin credentials. Existing Firestore rules remain responsible for browser-side operations, and clients still cannot write directly to protected Promotion/PDI collections.

## Scheduled checklist publication

`netlify/functions/publish-scheduled-checklists.mjs` replaces the Firebase scheduled function for the Netlify/Spark deployment. Netlify runs it at `03:05 UTC`, corresponding to `00:05` in `America/Sao_Paulo`; it retains the daily, weekly, and monthly recurrence rules and idempotent assignment IDs.

Netlify Scheduled Functions are available on all Netlify plans, but have a 30-second execution limit. The current job processes templates and recipients sequentially, so verify its run duration and logs after deployment. The fresh project starts with no historical workload; if the number of scheduled assignments grows enough to exceed the limit, the job will need bounded batching/background processing before that scale is reached.

## First-run verification

After the site and destination are configured:

1. Create the first account, set the real company name, and confirm it becomes the administrator in the new tenant.
2. Create a test employee and leader, assign them to a team, and verify ordinary evaluations and survey submissions.
3. Verify Promotion/PDI submission and administrative decisions, including server rejection of an indicator above 100%.
4. Create a scheduled checklist and confirm the Netlify scheduled-function logs and assignment results. Confirm a repeat invocation does not create duplicates.
5. Confirm the app is using project ID `hb-avalia2`; do not test against or publish to `hb-avalia`.

No deployment, Firebase project update, or production-data change has been performed by this preparation.
