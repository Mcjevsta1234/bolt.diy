import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';

/**
 * Admin-only endpoint that lists all application users.
 * Used for future admin UI and operational tooling.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { requireAdminFromRequest, listAllAppUsers, getAuthEnvFromContext } = await import('../../src/services/auth');

  const env = getAuthEnvFromContext(context);

  try {
    await requireAdminFromRequest(request, env);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Not authorized';

    const status =
      error instanceof Error && error.name === 'UnauthorizedError'
        ? 401
        : 403;

    return json({ error: message }, { status });
  }

  const users = await listAllAppUsers(env);

  return json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      disabled: user.disabled,
      created_at: user.created_at,
    })),
  });
}