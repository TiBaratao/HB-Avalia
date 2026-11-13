import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { provisionOrganizationStructure } from "../src/lib/server/organization-structure-core.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GCLOUD_PROJECT ?? "";
if (!/^(localhost|127\.0\.0\.1):\d+$/.test(emulatorHost) || !projectId.startsWith("demo-")) {
  throw new Error("Provisionamento permitido somente no emulador Firestore de um projeto demo-.");
}

const configurationPath = fileURLToPath(new URL("../config/organization-store-mapping.json", import.meta.url));
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const applyConfirmedCompanyMappings = process.argv.includes("--apply-confirmed-mappings");
const app = initializeApp({ projectId }, "hb-avalia-organization-provision");

try {
  const result = await provisionOrganizationStructure(getFirestore(app), configuration, {
    applyConfirmedCompanyMappings,
  });
  console.log(JSON.stringify({
    ...result,
    status: "Provisionamento do emulador concluído.",
    warning: applyConfirmedCompanyMappings
      ? "O vínculo da Matriz foi aplicado somente ao tenant sintético existente no emulador."
      : "Os vínculos com empresas existentes permanecem pendentes de confirmação.",
  }, null, 2));
} finally {
  await deleteApp(app);
}
