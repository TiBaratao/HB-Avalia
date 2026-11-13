function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasActiveDirectorGrant(organization, director, uid, emailValue) {
  const email = normalizeEmail(emailValue);
  return Boolean(uid && email
    && organization?.status === "ACTIVE"
    && organization.directorRole === "DIRECTOR"
    && director?.uid === uid
    && director.role === "DIRECTOR"
    && director.status === "ACTIVE"
    && normalizeEmail(director.email) === email);
}

module.exports = { hasActiveDirectorGrant };
