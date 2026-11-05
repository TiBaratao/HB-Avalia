/* eslint-disable @typescript-eslint/no-require-imports */
const { createHmac, randomBytes } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { SecureActionError } = require("./secure-actions-core");

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMISSIONS = 10;
const MAX_ACTIVE_CASHIERS = 100;
const MAX_RECENT_RESPONSES = 100;
const MIN_RESPONSES_FOR_RESULTS = 5;

class CustomerFeedbackError extends SecureActionError {
  constructor(code, message) {
    super(code, message);
    this.name = "CustomerFeedbackError";
  }
}

function requireString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("/")) {
    throw new CustomerFeedbackError("invalid-argument", `${label} inválido.`);
  }
  return value.trim();
}

function requireRating(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new CustomerFeedbackError("invalid-argument", `${label} deve ser uma nota de 1 a 5.`);
  }
  return value;
}

function safeQrToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(value)) {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }
  return value;
}

async function requireAdmin(db, uid, companyId) {
  const memberSnapshot = await db.collection("companies").doc(companyId).collection("members").doc(uid).get();
  const member = memberSnapshot.data();
  if (!memberSnapshot.exists || member?.status !== "ACTIVE" || member.role !== "ADMIN") {
    throw new CustomerFeedbackError("permission-denied", "Somente uma administradora ativa pode acessar estas avaliações.");
  }
}

function locationCollection(db, companyId) {
  return db.collection("companies").doc(companyId).collection("customerFeedbackLocations");
}

function qrTokenDocument(db, token) {
  return db.collection("customerFeedbackQrTokens").doc(token);
}

function makeQrToken() {
  return randomBytes(32).toString("base64url");
}

async function ensureGeneralLocation(db, companyId) {
  const locationRef = locationCollection(db, companyId).doc("general");
  const generatedToken = makeQrToken();
  const tokenRef = qrTokenDocument(db, generatedToken);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(locationRef);
    if (snapshot.exists) return;
    transaction.create(locationRef, {
      kind: "GENERAL",
      name: "Supermercado",
      active: true,
      publicToken: generatedToken,
      responseCount: 0,
      overallRatingTotal: 0,
      cashierRatingCount: 0,
      cashierRatingTotal: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(tokenRef, { companyId, locationId: "general", active: true });
  });

  const snapshot = await locationRef.get();
  if (!snapshot.exists) throw new CustomerFeedbackError("internal", "Não foi possível preparar o QR Code geral.");
  return { id: snapshot.id, ...snapshot.data() };
}

async function getPublicCustomerFeedbackForm(db, rawToken) {
  const token = safeQrToken(rawToken);
  const tokenSnapshot = await qrTokenDocument(db, token).get();
  if (!tokenSnapshot.exists || tokenSnapshot.get("active") !== true) {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }

  const { companyId, locationId } = tokenSnapshot.data();
  if (typeof companyId !== "string" || typeof locationId !== "string") {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }
  const companyRef = db.collection("companies").doc(companyId);
  const locationRef = locationCollection(db, companyId).doc(locationId);
  const [companySnapshot, locationSnapshot] = await Promise.all([companyRef.get(), locationRef.get()]);
  if (!companySnapshot.exists || !locationSnapshot.exists || locationSnapshot.get("active") !== true) {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }

  const location = locationSnapshot.data();
  const cashiers = location.kind === "GENERAL"
    ? (await locationCollection(db, companyId).where("kind", "==", "CASHIER").where("active", "==", true).limit(MAX_ACTIVE_CASHIERS).get())
      .docs.map((snapshot) => ({ id: snapshot.id, name: snapshot.get("name") }))
    : [];
  return {
    companyName: companySnapshot.get("name"),
    location: { id: locationSnapshot.id, kind: location.kind, name: location.name },
    cashiers,
  };
}

async function submitCustomerFeedback(db, input, clientAddress) {
  const token = safeQrToken(input.token);
  const overallRating = requireRating(input.overallRating, "A avaliação do supermercado");
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 1000) throw new CustomerFeedbackError("invalid-argument", "O comentário pode ter até 1.000 caracteres.");

  const cashierId = input.cashierId == null || input.cashierId === ""
    ? ""
    : requireString(input.cashierId, "Caixa", 128);
  const cashierRating = input.cashierRating == null || input.cashierRating === ""
    ? null
    : requireRating(input.cashierRating, "A avaliação do caixa");
  if (Boolean(cashierId) !== (cashierRating !== null)) {
    throw new CustomerFeedbackError("invalid-argument", "Selecione o caixa e informe uma nota para avaliar o atendimento.");
  }
  if (typeof input.website === "string" && input.website.trim()) {
    throw new CustomerFeedbackError("invalid-argument", "Não foi possível enviar a avaliação.");
  }

  const tokenRef = qrTokenDocument(db, token);
  const responseId = randomBytes(16).toString("hex");
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const tokenSnapshot = await transaction.get(tokenRef);
    if (!tokenSnapshot.exists || tokenSnapshot.get("active") !== true) {
      throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
    }

    const { companyId, locationId } = tokenSnapshot.data();
    if (typeof companyId !== "string" || typeof locationId !== "string") {
      throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
    }

    const companyRef = db.collection("companies").doc(companyId);
    const sourceLocationRef = locationCollection(db, companyId).doc(locationId);
    const securityRef = companyRef.collection("customerFeedbackPrivate").doc("rateLimitSecret");
    const [companySnapshot, sourceSnapshot, securitySnapshot] = await Promise.all([
      transaction.get(companyRef),
      transaction.get(sourceLocationRef),
      transaction.get(securityRef),
    ]);
    if (!companySnapshot.exists || !sourceSnapshot.exists || sourceSnapshot.get("active") !== true) {
      throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
    }
    const source = sourceSnapshot.data();
    if (source.kind === "CASHIER" && cashierId && cashierId !== locationId) {
      throw new CustomerFeedbackError("invalid-argument", "O QR Code identifica outro caixa.");
    }

    let cashierSnapshot = null;
    let cashierRef = null;
    if (cashierId) {
      cashierRef = locationCollection(db, companyId).doc(cashierId);
      cashierSnapshot = await transaction.get(cashierRef);
      if (!cashierSnapshot.exists || cashierSnapshot.get("kind") !== "CASHIER" || cashierSnapshot.get("active") !== true) {
        throw new CustomerFeedbackError("failed-precondition", "O caixa selecionado não está disponível.");
      }
    }

    const secret = securitySnapshot.exists ? securitySnapshot.get("secret") : randomBytes(32).toString("hex");
    if (typeof secret !== "string" || secret.length < 32) {
      throw new CustomerFeedbackError("internal", "A proteção contra envios repetidos não está configurada corretamente.");
    }
    const clientHash = createHmac("sha256", secret).update(String(clientAddress || "unknown")).digest("hex");
    const rateLimitRef = companyRef.collection("customerFeedbackRateLimits").doc(clientHash);
    const rateLimitSnapshot = await transaction.get(rateLimitRef);
    const previousWindow = rateLimitSnapshot.get("windowStartedAt");
    const previousWindowMs = previousWindow?.toMillis?.() ?? 0;
    const inCurrentWindow = now - previousWindowMs < RATE_LIMIT_WINDOW_MS;
    const currentCount = inCurrentWindow ? Number(rateLimitSnapshot.get("submissionCount") ?? 0) : 0;
    if (currentCount >= RATE_LIMIT_MAX_SUBMISSIONS) {
      throw new CustomerFeedbackError("resource-exhausted", "Limite temporário de envios atingido. Tente novamente mais tarde.");
    }

    const responseRef = companyRef.collection("customerFeedbackResponses").doc(responseId);
    const summaryRef = companyRef.collection("customerFeedbackSummaries").doc("overall");
    if (!securitySnapshot.exists) transaction.create(securityRef, { secret });
    transaction.set(rateLimitRef, {
      windowStartedAt: inCurrentWindow ? previousWindow : Timestamp.fromMillis(now),
      submissionCount: currentCount + 1,
      expiresAt: Timestamp.fromMillis(now + RATE_LIMIT_WINDOW_MS * 2),
    });
    transaction.create(responseRef, {
      sourceLocationId: locationId,
      sourceLocationName: source.name,
      cashierId: cashierId || null,
      cashierName: cashierSnapshot?.get("name") ?? null,
      overallRating,
      cashierRating,
      comment,
      submittedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(summaryRef, {
      responseCount: FieldValue.increment(1),
      overallRatingTotal: FieldValue.increment(overallRating),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const sourceUpdate = {
      responseCount: FieldValue.increment(1),
      overallRatingTotal: FieldValue.increment(overallRating),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (cashierRef && cashierRating !== null && cashierRef.path === sourceLocationRef.path) {
      Object.assign(sourceUpdate, {
        cashierRatingCount: FieldValue.increment(1),
        cashierRatingTotal: FieldValue.increment(cashierRating),
      });
    } else if (cashierRef && cashierRating !== null) {
      transaction.update(cashierRef, {
        cashierRatingCount: FieldValue.increment(1),
        cashierRatingTotal: FieldValue.increment(cashierRating),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(sourceLocationRef, sourceUpdate);
    return { accepted: true };
  });
}

async function manageCustomerFeedback(db, uid, data) {
  const companyId = requireString(data.companyId, "Empresa", 128);
  const action = requireString(data.action, "Ação", 40);
  await requireAdmin(db, uid, companyId);

  const locations = locationCollection(db, companyId);
  if (action === "list") {
    await ensureGeneralLocation(db, companyId);
    const companyRef = db.collection("companies").doc(companyId);
    const [companySnapshot, locationSnapshot, summarySnapshot] = await Promise.all([
      companyRef.get(),
      locations.get(),
      companyRef.collection("customerFeedbackSummaries").doc("overall").get(),
    ]);
    const locationList = locationSnapshot.docs.map((snapshot) => {
      const location = snapshot.data();
      const cashierRatingCount = Number(location.cashierRatingCount ?? 0);
      return {
        id: snapshot.id,
        kind: location.kind,
        name: location.name,
        active: location.active,
        publicToken: location.publicToken,
        responseCount: Number(location.responseCount ?? 0),
        cashierRatingCount,
        cashierAverage: cashierRatingCount >= MIN_RESPONSES_FOR_RESULTS
          ? Number(location.cashierRatingTotal ?? 0) / cashierRatingCount
          : null,
      };
    });
    const locationById = new Map(locationList.map((location) => [location.id, location]));
    const summary = summarySnapshot.exists ? summarySnapshot.data() : { responseCount: 0, overallRatingTotal: 0 };
    const responseCount = Number(summary.responseCount ?? 0);
    const responseSnapshot = responseCount >= MIN_RESPONSES_FOR_RESULTS
      ? await companyRef.collection("customerFeedbackResponses")
        .orderBy("submittedAt", "desc").limit(MAX_RECENT_RESPONSES * 5).get()
      : null;
    const recentResponses = (responseSnapshot?.docs ?? [])
      .filter((snapshot) => {
        const source = locationById.get(snapshot.get("sourceLocationId"));
        const cashierId = snapshot.get("cashierId");
        const cashier = typeof cashierId === "string" ? locationById.get(cashierId) : null;
        return (source?.responseCount ?? 0) >= MIN_RESPONSES_FOR_RESULTS
          && (!cashierId || (cashier?.cashierRatingCount ?? 0) >= MIN_RESPONSES_FOR_RESULTS);
      })
      .slice(0, MAX_RECENT_RESPONSES)
      .map((snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
        sourceLocationName: snapshot.get("sourceLocationName") || locationById.get(snapshot.get("sourceLocationId"))?.name || "Supermercado",
        submittedAt: snapshot.get("submittedAt")?.toDate?.().toISOString() ?? null,
      }));
    return {
      locations: locationList,
      summary: {
        responseCount,
        averageRating: responseCount >= MIN_RESPONSES_FOR_RESULTS
          ? Number(summary.overallRatingTotal ?? 0) / responseCount
          : null,
      },
      recentResponses,
      companyName: companySnapshot.get("name"),
      maxRecentResponses: MAX_RECENT_RESPONSES,
      privacyThreshold: MIN_RESPONSES_FOR_RESULTS,
    };
  }

  if (action === "createCashier") {
    const name = requireString(data.name, "Nome do caixa", 60);
    if (name.length < 2) throw new CustomerFeedbackError("invalid-argument", "O nome do caixa deve ter pelo menos 2 caracteres.");
    const locationRef = locations.doc();
    const token = makeQrToken();
    const tokenRef = qrTokenDocument(db, token);
    await db.runTransaction(async (transaction) => {
      const currentLocations = await transaction.get(locations.where("kind", "==", "CASHIER"));
      if (currentLocations.docs.filter((snapshot) => snapshot.get("active") === true).length >= MAX_ACTIVE_CASHIERS) {
        throw new CustomerFeedbackError("resource-exhausted", `O limite é de ${MAX_ACTIVE_CASHIERS} caixas.`);
      }
      if (currentLocations.docs.some((snapshot) => snapshot.get("name").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        throw new CustomerFeedbackError("already-exists", "Já existe um caixa com esse nome.");
      }
      transaction.create(locationRef, {
        kind: "CASHIER",
        name,
        active: true,
        publicToken: token,
        responseCount: 0,
        overallRatingTotal: 0,
        cashierRatingCount: 0,
        cashierRatingTotal: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(tokenRef, { companyId, locationId: locationRef.id, active: true });
    });
    return { locationId: locationRef.id, token };
  }

  if (action === "setCashierActive") {
    const locationId = requireString(data.locationId, "Caixa", 128);
    const active = data.active;
    if (typeof active !== "boolean") throw new CustomerFeedbackError("invalid-argument", "Estado do caixa inválido.");
    const locationRef = locations.doc(locationId);
    await db.runTransaction(async (transaction) => {
      const locationSnapshot = await transaction.get(locationRef);
      if (!locationSnapshot.exists || locationSnapshot.get("kind") !== "CASHIER") {
        throw new CustomerFeedbackError("not-found", "Caixa não encontrado.");
      }
      const tokenRef = qrTokenDocument(db, locationSnapshot.get("publicToken"));
      const tokenSnapshot = await transaction.get(tokenRef);
      transaction.update(locationRef, { active, updatedAt: FieldValue.serverTimestamp() });
      if (tokenSnapshot.exists) transaction.update(tokenRef, { active });
    });
    return { locationId, active };
  }

  if (action === "renameCashier") {
    const locationId = requireString(data.locationId, "Caixa", 128);
    const name = requireString(data.name, "Nome do caixa", 60);
    if (name.length < 2) throw new CustomerFeedbackError("invalid-argument", "O nome do caixa deve ter pelo menos 2 caracteres.");
    const locationRef = locations.doc(locationId);
    await db.runTransaction(async (transaction) => {
      const [locationSnapshot, cashierSnapshots] = await Promise.all([
        transaction.get(locationRef),
        transaction.get(locations.where("kind", "==", "CASHIER")),
      ]);
      if (!locationSnapshot.exists || locationSnapshot.get("kind") !== "CASHIER") {
        throw new CustomerFeedbackError("not-found", "Caixa não encontrado.");
      }
      if (cashierSnapshots.docs.some((snapshot) => snapshot.id !== locationId && snapshot.get("name").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        throw new CustomerFeedbackError("already-exists", "Já existe um caixa com esse nome.");
      }
      transaction.update(locationRef, { name, updatedAt: FieldValue.serverTimestamp() });
    });
    return { locationId, name };
  }

  if (action === "rotateQr") {
    const locationId = requireString(data.locationId, "Local", 128);
    const locationRef = locations.doc(locationId);
    const token = makeQrToken();
    const newTokenRef = qrTokenDocument(db, token);
    await db.runTransaction(async (transaction) => {
      const locationSnapshot = await transaction.get(locationRef);
      if (!locationSnapshot.exists || !["GENERAL", "CASHIER"].includes(locationSnapshot.get("kind"))) {
        throw new CustomerFeedbackError("not-found", "Local não encontrado.");
      }
      const oldTokenRef = qrTokenDocument(db, locationSnapshot.get("publicToken"));
      const oldTokenSnapshot = await transaction.get(oldTokenRef);
      if (oldTokenSnapshot.exists) transaction.update(oldTokenRef, { active: false });
      transaction.create(newTokenRef, { companyId, locationId, active: locationSnapshot.get("active") === true });
      transaction.update(locationRef, { publicToken: token, updatedAt: FieldValue.serverTimestamp() });
    });
    return { locationId, token };
  }

  throw new CustomerFeedbackError("invalid-argument", "Ação de avaliação de clientes inválida.");
}

module.exports = {
  CustomerFeedbackError,
  getPublicCustomerFeedbackForm,
  manageCustomerFeedback,
  submitCustomerFeedback,
};
