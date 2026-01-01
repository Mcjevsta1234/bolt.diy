import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { getCurrentUser } from '~/lib/.server/auth';
import { getAuditLog, type AuditLogEntry } from '~/lib/.server/adminDataStore';

interface AdminAuditLogLoaderData {
  entries: AuditLogEntry[];
}

/**
 * Loader: fetch recent audit log entries for the admin dashboard.
 * This is read-only and does not expose internal implementation details.
 */
async function adminAuditLogLoader({ request }: LoaderFunctionArgs) {
  const currentUser = getCurrentUser(request);

  if (currentUser.role !== 'admin' || currentUser.disabled) {
    return new Response('Forbidden', { status: 403 });
  }

  const entries = getAuditLog(200);

  return json<AdminAuditLogLoaderData>({ entries });
}

export const loader = withSecurity(adminAuditLogLoader, {
  requireAuth: true,
  rateLimit: true,
  allowedMethods: ['GET'],
});