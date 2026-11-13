class InvitationApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "InvitationApiError";
    this.status = status;
  }
}

module.exports = { InvitationApiError };
