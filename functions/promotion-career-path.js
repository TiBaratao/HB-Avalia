const PROMOTION_CAREER_PATH = Object.freeze([
  "Atendente de Açougue Júnior",
  "Atendente de Açougue Pleno",
  "Atendente de Açougue Elite",
  "Atendente de Açougue Elite Nível 1",
  "Açougueiro Júnior",
  "Açougueiro Pleno",
  "Açougueiro Elite",
  "Açougueiro Elite Nível 1",
  "Desossador",
]);

function normalizePosition(position) {
  return typeof position === "string"
    ? position.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")
    : "";
}

function getPromotionCareerProgress(currentPosition) {
  const currentIndex = PROMOTION_CAREER_PATH.findIndex(
    (position) => normalizePosition(position) === normalizePosition(currentPosition),
  );
  if (currentIndex < 0) return { currentPosition: null, nextPosition: null, isFinalPosition: false };
  return {
    currentPosition: PROMOTION_CAREER_PATH[currentIndex],
    nextPosition: PROMOTION_CAREER_PATH[currentIndex + 1] ?? null,
    isFinalPosition: currentIndex === PROMOTION_CAREER_PATH.length - 1,
  };
}

module.exports = { PROMOTION_CAREER_PATH, getPromotionCareerProgress };
