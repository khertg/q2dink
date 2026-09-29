/**
 * The Content-Security-Policy the production server sends. `deploy/Caddyfile` keeps an identical copy
 * (csp.test.ts fails if they drift apart), and `vite preview` serves it too, so the end-to-end tests run
 * the app under the same policy that production uses.
 *
 * - `data:` and `blob:` images are the player avatars (stored as data URLs) and the crop step.
 * - `blob:` media is a voice call-out's audio from the server (lib/announcer.ts), played from memory.
 * - `unsafe-inline` styles are React `style` attributes (avatar colours, the crop frame).
 * - Everything else is the app's own files and its own /api.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
