import type { Request } from 'express';

/** Request augmented by auth middleware once a caller is identified. */
export interface AuthedRequest extends Request {
  userId?: string;
  /** True when the request was authenticated via the server-to-server API key instead of a user JWT. */
  isServerCaller?: boolean;
}
