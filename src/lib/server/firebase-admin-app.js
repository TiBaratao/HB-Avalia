/* eslint-disable @typescript-eslint/no-require-imports */
const { cert, getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function isServiceAccount(value) {
  if (typeof value !== "object" || value === null) return false;
  const account = value;
  return typeof account.project_id === "string"
    && typeof account.client_email === "string"
    && typeof account.private_key === "string";
}

function getAdminApp() {
  const existing = getApps().find((app) => app.name === "hb-avalia-server");
  if (existing) return getApp("hb-avalia-server");

  const serializedAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serializedAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");

  let parsedAccount;
  try {
    parsedAccount = JSON.parse(serializedAccount);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
  }
  if (!isServiceAccount(parsedAccount)) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required service account fields.");
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (expectedProjectId && parsedAccount.project_id !== expectedProjectId) {
    throw new Error("The Firebase Admin service account does not match the configured Firebase project.");
  }

  return initializeApp({
    credential: cert({
      projectId: parsedAccount.project_id,
      clientEmail: parsedAccount.client_email,
      privateKey: parsedAccount.private_key,
    }),
    projectId: parsedAccount.project_id,
  }, "hb-avalia-server");
}

function getAdminAuth() {
  return getAuth(getAdminApp());
}

function getAdminFirestore() {
  return getFirestore(getAdminApp());
}

module.exports = { getAdminAuth, getAdminFirestore };
