import { parseCookies } from '~/lib/api/cookies';
import { upsertUserFromIdentity, type UserRole } from '~/lib/.server/adminDataStore';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  /**
   * Indicates that this user was synthesized from the request
   * (no authenticated identity / cookie present).
   */
  isAnonymous: boolean;
}

/**
 * Parse the authenticated user from the request cookies and hydrate it
 * with server-side state (role, disabled) from the admin data store.
 *
 * This implementation is intentionally simple and cookie-based so it can
 * work in the current environment without introducing a full auth system.
 *
 * - The cookie name is "bolt_user"
 * - The value is a JSON object: { id, email, role, disabled }
 *
 * If the cookie is missing or invalid, we return an anonymous \"member\"
 * user that is not disabled. This keeps existing functionality working
 * while still giving us a consistent user model for authorization checks.
 */
export function getCurrentUser(request: Request): AuthUser {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);

  const raw = cookies['bolt_user'];

  if (!raw) {
    return {
      id: 'anonymous',
      email: '',
      role: 'member',
      disabled: false,
      isAnonymous: true,
    };
  }

  try {
    const parsed = JSON.parse(raw);

    const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : 'anonymous';
    const email = typeof parsed.email === 'string' ? parsed.email : '';

    let claimedRole: UserRole | undefined;
    if (parsed.role === 'admin') {
      claimedRole = 'admin';
    } else if (parsed.role === 'member') {
      claimedRole = 'member';
    }

    // Persist/update the user in the admin data store and derive the
    // authoritative role/disabled state from there.
    const adminUser = upsertUserFromIdentity({
      id,
      email,
      role: claimedRole,
    });

    return {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      disabled: adminUser.disabled,
      isAnonymous: false,
    };
  } catch {
    // Fallback to anonymous user if cookie is malformed
    return {
      id: 'anonymous',
      email: '',
      role: 'member',
      disabled: false,
      isAnonymous: true,
    };
  }
}

/**
 * Ensure that the current user is an admin and not disabled.
 * Throws a Remix Response when authorization fails so it can be used
 * directly in loaders/actions.
 */
export function requireAdminUser(request: Request): AuthUser {
  const user = getCurrentUser(request);

  if (user.isAnonymous) {
    throw new Response('Unauthorized', { status: 401 });
  }

  if (user.disabled) {
    throw new Response('User account is disabled', { status: 403 });
  }

  if (user.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 });
  }

  return user;
}