/**
 * Thin re-export of the app-level storage adapter so that other packages or
 * tooling that expect `src/services/storageAdapter` can import it without
 * knowing about the Remix `app/` directory layout.
 *
 * This file is primarily for the SaaS branch and internal tooling; the Remix
 * app itself should import from `~/lib/services/storageAdapter`.
 */
export * from '../../app/lib/services/storageAdapter';