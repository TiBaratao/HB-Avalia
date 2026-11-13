/* eslint-disable @typescript-eslint/no-require-imports */
const { createHmac, randomBytes } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { SecureActionError } = require("./secure-actions-core");
const { profileMatchesCompany } = require("./company-access-core");

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMISSIONS = 10;
const RATE_LIMIT_SLOT_COUNT = 65_536;
const RATE_LIMIT_MAX_ACTIVE_CLIENTS_PER_SLOT = 1024;
const MAX_ACTIVE_CASHIERS = 100;
const MAX_RECENT_RESPONSES = 100;
const MIN_RESPONSES_FOR_RESULTS = 5;
const LEGACY_MATRIX_COMPANY_ID = "hb-avalia";
const CUSTOMER_FEEDBACK_MARKETS = Object.freeze([
  { id: "matriz", name: "Matriz" },
  { id: "loja-2", name: "Loja 2" },
  { id: "summit", name: "Summit" },
]);

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

function rateLimitSlotId(clientHash) {
  const slot = Number.parseInt(clientHash.slice(0, 8), 16) % RATE_LIMIT_SLOT_COUNT;
  return `slot-${slot.toString(16).padStart(4, "0")}`;
}

function safeQrToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(value)) {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }
  return value;
}

async function requireAdmin(db, uid, companyId) {
  const [memberSnapshot, profileSnapshot] = await Promise.all([
    db.collection("companies").doc(companyId).collection("members").doc(uid).get(),
    db.collection("userProfiles").doc(uid).get(),
  ]);
  const member = memberSnapshot.data();
  if (!profileMatchesCompany(profileSnapshot, companyId)
    || !memberSnapshot.exists || member?.status !== "ACTIVE" || member.role !== "ADMIN") {
    throw new CustomerFeedbackError("permission-denied", "Somente uma administradora ativa pode acessar estas avaliações.");
  }
}

function getCompanyStoreId(companySnapshot) {
  const organizationId = companySnapshot.get("organizationId");
  const storeId = companySnapshot.get("storeId");
  if (organizationId == null && storeId == null) return null;
  if (typeof organizationId !== "string" || !organizationId
    || typeof storeId !== "string" || !storeId
    || !CUSTOMER_FEEDBACK_MARKETS.some((market) => market.id === storeId)) {
    throw new CustomerFeedbackError("failed-precondition", "O vínculo da empresa com sua unidade não está configurado corretamente.");
  }
  return { organizationId, storeId };
}

async function getCompanyMarketScope(db, companySnapshot, companyId, transaction = null) {
  const companyStore = getCompanyStoreId(companySnapshot);
  if (!companyStore) return { storeId: null, markets: CUSTOMER_FEEDBACK_MARKETS, allowUnassignedLocations: false };

  const organizationRef = db.collection("organizations").doc(companyStore.organizationId);
  const storeRef = organizationRef.collection("stores").doc(companyStore.storeId);
  const [organizationSnapshot, storeSnapshot] = await Promise.all([
    transaction ? transaction.get(organizationRef) : organizationRef.get(),
    transaction ? transaction.get(storeRef) : storeRef.get(),
  ]);
  if (!organizationSnapshot.exists || organizationSnapshot.get("status") !== "ACTIVE"
    || !storeSnapshot.exists
    || storeSnapshot.get("organizationId") !== companyStore.organizationId
    || storeSnapshot.get("storeId") !== companyStore.storeId
    || storeSnapshot.get("companyId") !== companyId
    || storeSnapshot.get("status") !== "ACTIVE"
    || storeSnapshot.get("companyMappingStatus") !== "CONFIRMED") {
    throw new CustomerFeedbackError("failed-precondition", "O vínculo desta empresa com a unidade não está confirmado.");
  }

  const market = CUSTOMER_FEEDBACK_MARKETS.find(({ id }) => id === companyStore.storeId);
  if (!market) {
    throw new CustomerFeedbackError("failed-precondition", "A unidade vinculada não possui um mercado de avaliação configurado.");
  }
  const isLegacyMatrix = companyId === LEGACY_MATRIX_COMPANY_ID && companyStore.storeId === "matriz";
  return {
    storeId: companyStore.storeId,
    markets: isLegacyMatrix ? CUSTOMER_FEEDBACK_MARKETS : [market],
    allowUnassignedLocations: isLegacyMatrix,
  };
}

function requireAllowedMarket(marketId, marketScope) {
  if (marketScope.markets.some((market) => market.id === marketId)) return;
  if (CUSTOMER_FEEDBACK_MARKETS.some((market) => market.id === marketId)) {
    throw new CustomerFeedbackError("permission-denied", "Esta empresa não pode acessar avaliações de outra unidade.");
  }
  throw new CustomerFeedbackError("invalid-argument", "Selecione um mercado válido.");
}

function isAllowedLocation(location, marketScope) {
  if (!location || typeof location !== "object") return false;
  if (marketScope.allowUnassignedLocations
    && ["GENERAL", "CASHIER"].includes(location.kind)
    && (location.marketId == null || location.marketId === "")) {
    return true;
  }
  return ["MARKET", "CASHIER"].includes(location.kind)
    && marketScope.markets.some(({ id }) => id === location.marketId);
}

function requireAllowedLocation(location, marketScope) {
  if (!isAllowedLocation(location, marketScope)) {
    requireAllowedMarket(location?.marketId, marketScope);
  }
}

function requireAllowedQrManagementLocation(location, marketScope) {
  if (marketScope.storeId == null && location?.kind === "GENERAL") return;
  requireAllowedLocation(location, marketScope);
}

function locationCollection(db, companyId) {
  return db.collection("companies").doc(companyId).collection("customerFeedbackLocations");
}

function qrTokenDocument(db, token) {
  return db.collection("customerFeedbackQrTokens").doc(token);
}

function tokenMatchesLocation(tokenSnapshot, companyId, locationId) {
  return tokenSnapshot.exists
    && tokenSnapshot.get("companyId") === companyId
    && tokenSnapshot.get("locationId") === locationId;
}

function makeQrToken() {
  return randomBytes(32).toString("base64url");
}

async function ensureMarketLocations(db, companyId, markets) {
  const locations = locationCollection(db, companyId);
  await Promise.all(markets.map(async ({ id, name }) => {
    const locationRef = locations.doc(`market-${id}`);
    const generatedToken = makeQrToken();
    const tokenRef = qrTokenDocument(db, generatedToken);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(locationRef);
      if (snapshot.exists) return;
      transaction.create(locationRef, {
        kind: "MARKET",
        marketId: id,
        name,
        active: true,
        publicToken: generatedToken,
        responseCount: 0,
        overallRatingTotal: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(tokenRef, { companyId, locationId: locationRef.id, active: true });
    });
  }));
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

  const marketScope = await getCompanyMarketScope(db, companySnapshot, companyId);
  const location = locationSnapshot.data();
  if (location.publicToken !== token
    || !isAllowedLocation(location, marketScope)) {
    throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
  }
  const marketRef = location.marketId ? locationCollection(db, companyId).doc(`market-${location.marketId}`) : null;
  const marketSnapshot = location.kind === "MARKET" ? locationSnapshot : marketRef ? await marketRef.get() : null;
  const cashiers = location.kind === "MARKET"
    ? (await locationCollection(db, companyId)
      .where("kind", "==", "CASHIER")
      .where("marketId", "==", location.marketId)
      .where("active", "==", true)
      .limit(MAX_ACTIVE_CASHIERS)
      .get()).docs.map((snapshot) => ({ id: snapshot.id, name: snapshot.get("name") }))
    : location.kind === "GENERAL"
      ? (await locationCollection(db, companyId)
        .where("kind", "==", "CASHIER")
        .where("active", "==", true)
        .limit(MAX_ACTIVE_CASHIERS)
        .get()).docs
        .filter((snapshot) => !snapshot.get("marketId"))
        .map((snapshot) => ({ id: snapshot.id, name: snapshot.get("name") }))
      : [];
  return {
    companyName: companySnapshot.get("name"),
    location: {
      id: locationSnapshot.id,
      kind: location.kind,
      name: location.name,
      marketId: typeof location.marketId === "string" ? location.marketId : null,
      marketName: marketSnapshot?.get("name") ?? null,
    },
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
    const marketScope = await getCompanyMarketScope(db, companySnapshot, companyId, transaction);
    const source = sourceSnapshot.data();
    if (source.publicToken !== token || !isAllowedLocation(source, marketScope)) {
      throw new CustomerFeedbackError("not-found", "Este QR Code não está disponível.");
    }
    if (source.kind === "CASHIER" && cashierId && cashierId !== locationId) {
      throw new CustomerFeedbackError("invalid-argument", "O QR Code identifica outro caixa.");
    }

    const marketId = source.kind === "MARKET"
      ? source.marketId
      : typeof source.marketId === "string" ? source.marketId : null;
    const marketRef = marketId ? locationCollection(db, companyId).doc(`market-${marketId}`) : null;
    const marketSnapshot = marketRef
      ? source.kind === "MARKET" ? sourceSnapshot : await transaction.get(marketRef)
      : null;
    if (marketRef && (!marketSnapshot?.exists || marketSnapshot.get("kind") !== "MARKET" || marketSnapshot.get("active") !== true)) {
      throw new CustomerFeedbackError("failed-precondition", "O mercado associado a este QR Code não está disponível.");
    }

    let cashierSnapshot = null;
    let cashierRef = null;
    if (cashierId) {
      cashierRef = locationCollection(db, companyId).doc(cashierId);
      cashierSnapshot = await transaction.get(cashierRef);
      if (!cashierSnapshot.exists || cashierSnapshot.get("kind") !== "CASHIER" || cashierSnapshot.get("active") !== true) {
        throw new CustomerFeedbackError("failed-precondition", "O caixa selecionado não está disponível.");
      }
      if (marketId && cashierSnapshot.get("marketId") !== marketId) {
        throw new CustomerFeedbackError("invalid-argument", "O caixa selecionado pertence a outro mercado.");
      }
      if (!marketId && cashierSnapshot.get("marketId")) {
        throw new CustomerFeedbackError("invalid-argument", "O caixa selecionado pertence a outro mercado.");
      }
    }

    const secret = securitySnapshot.exists ? securitySnapshot.get("secret") : randomBytes(32).toString("hex");
    if (typeof secret !== "string" || secret.length < 32) {
      throw new CustomerFeedbackError("internal", "A proteção contra envios repetidos não está configurada corretamente.");
    }
    const clientHash = createHmac("sha256", secret).update(String(clientAddress || "unknown")).digest("hex");
    const rateLimitRef = companyRef.collection("customerFeedbackRateLimits").doc(rateLimitSlotId(clientHash));
    const rateLimitSnapshot = await transaction.get(rateLimitRef);
    const storedClients = rateLimitSnapshot.get("clients");
    const clients = storedClients && typeof storedClients === "object" && !Array.isArray(storedClients)
      ? storedClients
      : {};
    const activeClients = Object.fromEntries(Object.entries(clients).filter(([, counter]) => {
      const windowStartedAt = counter?.windowStartedAt;
      return typeof windowStartedAt?.toMillis === "function"
        && now - windowStartedAt.toMillis() < RATE_LIMIT_WINDOW_MS;
    }));
    const clientCounter = activeClients[clientHash];
    const previousWindow = clientCounter?.windowStartedAt;
    const inCurrentWindow = previousWindow != null;
    const currentCount = inCurrentWindow ? Number(clientCounter.submissionCount ?? 0) : 0;
    if (currentCount >= RATE_LIMIT_MAX_SUBMISSIONS) {
      throw new CustomerFeedbackError("resource-exhausted", "Limite temporário de envios atingido. Tente novamente mais tarde.");
    }
    if (!inCurrentWindow && Object.keys(activeClients).length >= RATE_LIMIT_MAX_ACTIVE_CLIENTS_PER_SLOT) {
      throw new CustomerFeedbackError("resource-exhausted", "Muitas origens enviaram avaliações ao mesmo tempo. Tente novamente mais tarde.");
    }

    const responseRef = companyRef.collection("customerFeedbackResponses").doc(responseId);
    const summaryRef = companyRef.collection("customerFeedbackSummaries").doc("overall");
    if (!securitySnapshot.exists) transaction.create(securityRef, { secret });
    transaction.set(rateLimitRef, {
      clients: {
        ...activeClients,
        [clientHash]: {
          windowStartedAt: inCurrentWindow ? previousWindow : Timestamp.fromMillis(now),
          submissionCount: currentCount + 1,
        },
      },
    });
    transaction.create(responseRef, {
      sourceLocationId: locationId,
      sourceLocationName: source.name,
      marketId: marketId ?? null,
      marketName: marketSnapshot?.get("name") ?? null,
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
    if (marketRef && marketRef.path !== sourceLocationRef.path) {
      transaction.update(marketRef, {
        responseCount: FieldValue.increment(1),
        overallRatingTotal: FieldValue.increment(overallRating),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { accepted: true };
  });
}

async function manageCustomerFeedback(db, uid, data) {
  const companyId = requireString(data.companyId, "Empresa", 128);
  const action = requireString(data.action, "Ação", 40);
  await requireAdmin(db, uid, companyId);

  const locations = locationCollection(db, companyId);
  const companyRef = db.collection("companies").doc(companyId);
  const companySnapshot = await companyRef.get();
  if (!companySnapshot.exists) {
    throw new CustomerFeedbackError("not-found", "Empresa não encontrada.");
  }
  const marketScope = await getCompanyMarketScope(db, companySnapshot, companyId);

  if (action === "list") {
    await ensureMarketLocations(db, companyId, marketScope.markets);
    const [locationSnapshot, summarySnapshot] = await Promise.all([
      locations.get(),
      companyRef.collection("customerFeedbackSummaries").doc("overall").get(),
    ]);
    const activeMarketLocations = locationSnapshot.docs.filter((snapshot) =>
      isAllowedLocation(snapshot.data(), marketScope));
    const locationById = new Map(activeMarketLocations.map((snapshot) => [snapshot.id, snapshot.data()]));
    const locationList = activeMarketLocations.map((snapshot) => {
      const location = snapshot.data();
      const cashierRatingCount = Number(location.cashierRatingCount ?? 0);
      const responseCount = Number(location.responseCount ?? 0);
      return {
        id: snapshot.id,
        kind: location.kind,
        marketId: typeof location.marketId === "string" ? location.marketId : null,
        name: location.name,
        active: location.active,
        publicToken: location.publicToken,
        responseCount,
        averageRating: location.kind === "MARKET" && responseCount >= MIN_RESPONSES_FOR_RESULTS
          ? Number(location.overallRatingTotal ?? 0) / responseCount
          : null,
        cashierRatingCount,
        cashierAverage: cashierRatingCount >= MIN_RESPONSES_FOR_RESULTS
          ? Number(location.cashierRatingTotal ?? 0) / cashierRatingCount
          : null,
      };
    });
    const scopedMarket = marketScope.storeId
      ? activeMarketLocations.find((snapshot) =>
        snapshot.get("kind") === "MARKET" && snapshot.get("marketId") === marketScope.storeId)
      : null;
    const summary = scopedMarket && !marketScope.allowUnassignedLocations
      ? scopedMarket.data()
      : summarySnapshot.exists ? summarySnapshot.data() : { responseCount: 0, overallRatingTotal: 0 };
    const responseCount = Number(summary.responseCount ?? 0);
    const responseCollection = companyRef.collection("customerFeedbackResponses");
    const recentResponseSnapshots = marketScope.allowUnassignedLocations
      ? (await responseCollection.orderBy("submittedAt", "desc").limit(MAX_RECENT_RESPONSES).get()).docs
      : (await Promise.all(marketScope.markets.map(({ id }) =>
        responseCollection.where("marketId", "==", id).orderBy("submittedAt", "desc").limit(MAX_RECENT_RESPONSES).get())))
        .flatMap((snapshot) => snapshot.docs)
        .sort((first, second) =>
          (second.get("submittedAt")?.toMillis?.() ?? 0) - (first.get("submittedAt")?.toMillis?.() ?? 0));
    const recentResponses = recentResponseSnapshots.map((snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
        sourceLocationName: snapshot.get("sourceLocationName") || locationById.get(snapshot.get("sourceLocationId"))?.name || "Supermercado",
        marketId: typeof snapshot.get("marketId") === "string" ? snapshot.get("marketId") : null,
        marketName: typeof snapshot.get("marketName") === "string" ? snapshot.get("marketName") : null,
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
      markets: marketScope.markets,
    };
  }

  if (action === "createCashier") {
    const name = requireString(data.name, "Nome do caixa", 60);
    const marketId = requireString(data.marketId, "Mercado", 40);
    if (name.length < 2) throw new CustomerFeedbackError("invalid-argument", "O nome do caixa deve ter pelo menos 2 caracteres.");
    requireAllowedMarket(marketId, marketScope);
    const locationRef = locations.doc();
    const token = makeQrToken();
    const tokenRef = qrTokenDocument(db, token);
    await db.runTransaction(async (transaction) => {
      const marketRef = locations.doc(`market-${marketId}`);
      const [currentLocations, marketSnapshot] = await Promise.all([
        transaction.get(locations.where("kind", "==", "CASHIER")),
        transaction.get(marketRef),
      ]);
      if (!marketSnapshot.exists || marketSnapshot.get("kind") !== "MARKET" || marketSnapshot.get("active") !== true) {
        throw new CustomerFeedbackError("failed-precondition", "O mercado selecionado não está disponível.");
      }
      if (currentLocations.docs.filter((snapshot) => snapshot.get("active") === true).length >= MAX_ACTIVE_CASHIERS) {
        throw new CustomerFeedbackError("resource-exhausted", `O limite é de ${MAX_ACTIVE_CASHIERS} caixas.`);
      }
      if (currentLocations.docs.some((snapshot) => snapshot.get("marketId") === marketId
        && snapshot.get("name").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        throw new CustomerFeedbackError("already-exists", "Já existe um caixa com esse nome.");
      }
      transaction.create(locationRef, {
        kind: "CASHIER",
        marketId,
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
      requireAllowedLocation(locationSnapshot.data(), marketScope);
      const currentToken = locationSnapshot.get("publicToken");
      if (typeof currentToken !== "string" || !currentToken) {
        throw new CustomerFeedbackError("failed-precondition", "O QR Code do caixa não está configurado.");
      }
      const tokenRef = qrTokenDocument(db, currentToken);
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenMatchesLocation(tokenSnapshot, companyId, locationId)) {
        throw new CustomerFeedbackError("failed-precondition", "O QR Code do caixa não corresponde à empresa.");
      }
      transaction.update(locationRef, { active, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(tokenRef, { active });
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
      requireAllowedQrManagementLocation(locationSnapshot.data(), marketScope);
      if (cashierSnapshots.docs.some((snapshot) => snapshot.id !== locationId
        && snapshot.get("marketId") === locationSnapshot.get("marketId")
        && snapshot.get("name").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
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
      if (!locationSnapshot.exists || !["GENERAL", "MARKET", "CASHIER"].includes(locationSnapshot.get("kind"))) {
        throw new CustomerFeedbackError("not-found", "Local não encontrado.");
      }
      requireAllowedLocation(locationSnapshot.data(), marketScope);
      const currentToken = locationSnapshot.get("publicToken");
      if (typeof currentToken !== "string" || !currentToken) {
        throw new CustomerFeedbackError("failed-precondition", "O QR Code do local não está configurado.");
      }
      const oldTokenRef = qrTokenDocument(db, currentToken);
      const oldTokenSnapshot = await transaction.get(oldTokenRef);
      if (oldTokenSnapshot.exists && !tokenMatchesLocation(oldTokenSnapshot, companyId, locationId)) {
        throw new CustomerFeedbackError("failed-precondition", "O QR Code do local pertence a outra empresa.");
      }
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
  rateLimitSlotId,
  submitCustomerFeedback,
};
