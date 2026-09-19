import type { ServiceErrorCode } from '@classroom/shared';

export class ServiceError extends Error {
  constructor(readonly code: ServiceErrorCode, message: string, readonly status = 400, readonly details?: unknown) { super(message); }
}

export function errorBody(error: unknown) {
  if (error instanceof ServiceError) return { error: error.message, code: error.code, details: error.details };
  return { error: error instanceof Error ? error.message : 'Unexpected server error.', code: 'INVALID_REQUEST' as const };
}
