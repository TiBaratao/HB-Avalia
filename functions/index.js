const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { publishScheduledChecklists } = require("./scheduled-checklists-core");

initializeApp();

exports.publishScheduledChecklists = onSchedule(
  {
    schedule: "5 0 * * *",
    region: "southamerica-east1",
    timeZone: "America/Sao_Paulo",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => publishScheduledChecklists(getFirestore(), { logger, fieldValue: FieldValue }),
);

const secureActions = require("./secure-actions");
Object.assign(exports, secureActions);
