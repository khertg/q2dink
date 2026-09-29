import type { ErrorCode } from '@q2dink/shared'

const STATUS: Record<ErrorCode, number> = {
  weak_password: 400,
  invalid_club: 400,
  club_slug_taken: 409,
  invalid_credentials: 401,
  invalid_recovery_code: 401,
  invalid_token: 401,
  invalid_snapshot: 400,
  invalid_players: 400,
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,
  conflict: 409,
  name_taken: 409,
  speech_unavailable: 503,
  speech_failed: 502,
}

const MESSAGE: Record<ErrorCode, string> = {
  weak_password: 'Passwords need between 8 and 128 characters.',
  invalid_club: 'That club name does not make a valid URL. Use 3 to 40 letters, numbers or dashes.',
  club_slug_taken: 'That club URL is already taken.',
  invalid_credentials: 'Wrong club URL or password.',
  invalid_recovery_code: 'That recovery code is not valid.',
  invalid_token: 'Your club login is missing or expired. Please log in again.',
  invalid_snapshot: 'The session data is not in a format the server accepts.',
  invalid_players: 'The leaderboard update is not valid.',
  invalid_request: 'The request is not valid.',
  not_found: 'Not found.',
  rate_limited: 'Too many attempts. Please wait a while and try again.',
  payload_too_large: 'That request is too large.',
  internal_error: 'Something went wrong on the server.',
  conflict: 'The session changed on another staff device.',
  name_taken: 'Another device of this club is already called that.',
  speech_unavailable: 'Voice call-outs are not available on this server right now.',
  speech_failed: 'The voice service did not answer.',
}

/** An expected failure that maps to a specific HTTP status and error code. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly retryAfterSeconds: number | undefined

  constructor(code: ErrorCode, options: { message?: string; retryAfterSeconds?: number } = {}) {
    super(options.message ?? MESSAGE[code])
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export const defaultMessage = (code: ErrorCode) => MESSAGE[code]
export const statusFor = (code: ErrorCode) => STATUS[code]
