export declare class InvitationApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number);
}
