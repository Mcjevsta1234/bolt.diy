import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { getCurrentUser } from '~/lib/.server/auth';
import {
  listFeatureFlags,
  upsertFeatureFlag,
  type FeatureFlagRecord,
  type FeatureFlagScopeType,
} from '~/lib/.server/adminDataStore';

interface AdminFlagsLoaderData {
  flags: FeatureFlagRecord[];
}

/**
 * Loader: list all feature flags for the admin dashboard.
 */
async function adminFlagsLoader({ request }: LoaderFunctionArgs) {
  const currentUser = getCurrentUser(request);

  if (currentUser.role !== 'admin' || currentUser.disabled) {
    return new Response('Forbidden', { status: 403 });
  }

  const flags = listFeatureFlags();

  return json<AdminFlagsLoaderData>({ flags });
}

export const loader = withSecurity(adminFlagsLoader, {
  requireAuth: true,
  rateLimit: true,
  allowedMethods: ['GET'],
});

type AdminFlagsActionBody = {
  action: 'upsert';
  key: string;
  enabled: boolean;
  scopeType?: FeatureFlagScopeType;
  scopeId?: string | null;
};

/**
 * Action: create or update a feature flag.
 * This is the authoritative path for mutating feature flags.
 */
async function adminFlagsAction({ request }: ActionFunctionArgs) {
  const currentUser = getCurrentUser(request);

  if (currentUser.role !== 'admin' || currentUser.disabled) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: AdminFlagsActionBody;

  try {
    body = (await request.json()) as AdminFlagsActionBody;
  } catch {
    return new Response('Invalid request body', { status: 400 });
  }

  if (!body || body.action !== 'upsert') {
    return new Response('Invalid action', { status: 400 });
  }

  if (!body.key || typeof body.key !== 'string') {
    return new Response('Flag key is required', { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return new Response('Flag enabled state is required', { status: 400 });
  }

  if (body.scopeType && body.scopeType !== 'global' && body.scopeType !== 'user' && body.scopeType !== 'workspace') {
    return new Response('Invalid scopeType', { status: 400 });
  }

  try {
    const updated = upsertFeatureFlag({
      actorUserId: currentUser.id,
      key: body.key,
      enabled: body.enabled,
      scopeType: body.scopeType,
      scopeId: body.scopeId ?? null,
    });

    return json<{ flag: FeatureFlagRecord }>({ flag: updated });
  } catch (error) {
    console.error('Error processing admin flags action:', error);
    return new Response('Failed to process feature flag update', { status: 500 });
  }
}

export const action = withSecurity(adminFlagsAction, {
  requireAuth: true,
  rateLimit: true,
  allowedMethods: ['POST'],
});