import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { getCurrentUser } from '~/lib/.server/auth';
import {
  listUsers,
  setUserDisabled,
  setUserRole,
  type AdminUser,
  type UserRole,
} from '~/lib/.server/adminDataStore';

interface AdminUsersLoaderData {
  users: AdminUser[];
}

/**
 * Loader: list users for the admin dashboard.
 */
async function adminUsersLoader({ request }: LoaderFunctionArgs) {
  const currentUser = getCurrentUser(request);

  if (currentUser.role !== 'admin' || currentUser.disabled) {
    return new Response('Forbidden', { status: 403 });
  }

  const users = listUsers();

  return json<AdminUsersLoaderData>({ users });
}

export const loader = withSecurity(adminUsersLoader, {
  requireAuth: true,
  rateLimit: true,
  allowedMethods: ['GET'],
});

type AdminUsersActionBody =
  | {
      action: 'setDisabled';
      userId: string;
      disabled: boolean;
    }
  | {
      action: 'setRole';
      userId: string;
      role: UserRole;
    };

/**
 * Action: mutate user state (disable/enable, role changes).
 * All operations are validated server-side and audited.
 */
async function adminUsersAction({ request }: ActionFunctionArgs) {
  const currentUser = getCurrentUser(request);

  if (currentUser.role !== 'admin' || currentUser.disabled) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: AdminUsersActionBody;

  try {
    body = (await request.json()) as AdminUsersActionBody;
  } catch {
    return new Response('Invalid request body', { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return new Response('Invalid request body', { status: 400 });
  }

  try {
    switch (body.action) {
      case 'setDisabled': {
        if (typeof body.userId !== 'string' || typeof body.disabled !== 'boolean') {
          return new Response('Invalid setDisabled payload', { status: 400 });
        }

        const updatedUser = setUserDisabled(currentUser.id, body.userId, body.disabled);
        return json<{ user: AdminUser }>({ user: updatedUser });
      }

      case 'setRole': {
        if (typeof body.userId !== 'string' || (body.role !== 'admin' && body.role !== 'member')) {
          return new Response('Invalid setRole payload', { status: 400 });
        }

        const updatedUser = setUserRole(currentUser.id, body.userId, body.role);
        return json<{ user: AdminUser }>({ user: updatedUser });
      }

      default: {
        return new Response('Unknown action', { status: 400 });
      }
    }
  } catch (error) {
    console.error('Error processing admin users action:', error);
    return new Response('Failed to process admin action', { status: 500 });
  }
}

export const action = withSecurity(adminUsersAction, {
  requireAuth: true,
  rateLimit: true,
  allowedMethods: ['POST'],
});