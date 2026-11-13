function profileMatchesCompany(profileSnapshot, companyId) {
  return Boolean(profileSnapshot?.exists && profileSnapshot.get("companyId") === companyId);
}

module.exports = { profileMatchesCompany };
