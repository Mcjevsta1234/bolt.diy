import type { AppLoadContext } from '@remix-run/cloudflare';

export type AppUserRole = 'admin' | 'member';

export interface AuthSession {
  accessToken: string;
  refreshToken?: string | null;
}

export interface SupabaseAuthUser {
  id: string;
  email: string;
}

export interface AppUser {
  id: string;
  email: string;
  role: AppUserRole;
  disabled: boolean;
  created_at: string;
}

/**
 * Errors used by auth helpers so route handlers can distinguish cases.
 */
export class UnauthorizedError extends Error {
  name = 'UnauthorizedError' as const;
}

export class ForbiddenError extends Error {
  name = 'ForbiddenError' as const;
}

export class AccountDisabledError extends Error {
  name = 'AccountDisabledError' as const;
}

const SESSION_COOKIE_NAME = 'sb_session';

/**
 * Minimal environment shape we care about – compatible with both
 * Cloudflare (context.cloudflare.env) and Node (process.env).
 */
export type AuthEnv = Record<string, string | undefined>;

interface SupabaseConfig {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
  adminEmailAllowlist?: string;
}

function normalizeSupabaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function getAuthEnvFromContext(context: AppLoadContext | any): AuthEnv {
  const cloudflareEnv = context?.cloudflare?.env as AuthEnv | undefined;

  return cloudflareEnv ?? (process.env as AuthEnv);
}

export function getSupabaseConfig(env: AuthEnv): SupabaseConfig {
  const supabaseUrl = env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmailAllowlist = env.ADMIN_EMAIL_ALLOWLIST ?? process.env.ADMIN_EMAIL_ALLOWLIST;

  if (!supabaseUrl || !anonKey) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured');
  }

  return {
    supabaseUrl: normalizeSupabaseUrl(supabaseUrl),
    anonKey,
    serviceRoleKey,
    adminEmailAllowlist,
  };
}

function buildSupabaseUrl(config: SupabaseConfig, path: string): string {
  return `${config.supabaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function parseAdminEmailAllowlist(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Low-level Supabase Auth calls
 */

async function supabaseAuthRequest<T>(
  config: SupabaseConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(buildSupabaseUrl(config, path), {
    ...init,
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let json: any = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non‑JSON response – surface status text below
    }
  }

  if (!response.ok) {
    const message =
      json.error_description || json.error || json.message || response.statusText || 'Supabase auth error';

    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }

    throw new Error(message);
  }

  return json as T;
}

export async function signUpWithEmailPassword(
  env: AuthEnv,
  email: string,
  password: string,
): Promise<void> {
  const config = getSupabaseConfig(env);

  await supabaseAuthRequest<any>(config, '/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function signInWithEmailPassword(
  env: AuthEnv,
  email: string,
  password: string,
): Promise<{ session: AuthSession; authUser: SupabaseAuthUser }> {
  const config = getSupabaseConfig(env);

  const data = await supabaseAuthRequest<any>(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!data.access_token || !data.user) {
    throw new Error('Invalid response from Supabase when signing in');
  }

  const session: AuthSession = {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? null,
  };

  const authUser: SupabaseAuthUser = {
    id: data.user.id as string,
    email: data.user.email as string,
  };

  return { session, authUser };
}

export async function getSupabaseAuthUserFromSession(
  env: AuthEnv,
  session: AuthSession,
): Promise<SupabaseAuthUser> {
  const config = getSupabaseConfig(env);

  const response = await fetch(buildSupabaseUrl(config, '/auth/v1/user'), {
    method: 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  const text = await response.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // ignore parse error, handled below
    }
  }

  if (response.status === 401) {
    throw new UnauthorizedError(data?.message || 'Invalid or expired auth token');
  }

  if (!response.ok) {
    throw new Error(data?.message || response.statusText || 'Failed to fetch Supabase user');
  }

  if (!data?.id || !data?.email) {
    throw new Error('Supabase user payload missing id or email');
  }

  return {
    id: data.id as string,
    email: data.email as string,
  };
}

/**
 * Cookie helpers
 */

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  for (const item of items) {
    if (!item) continue;
    const [name, ...rest] = item.split('=');
    if (!name || rest.length === 0) continue;

    const decodedName = decodeURIComponent(name.trim());
    const decodedValue = decodeURIComponent(rest.join('=').trim());
    cookies[decodedName] = decodedValue;
  }

  return cookies;
}

export function getAuthSessionFromRequest(request: Request): AuthSession | null {
  const cookieHeader = request.headers.get('Cookie');
  const cookies = parseCookies(cookieHeader);

  const raw = cookies[SESSION_COOKIE_NAME];

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;

    if (!parsed.accessToken) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
    };
  } catch {
    return null;
  }
}

export function createAuthSessionCookie(session: AuthSession, env?: AuthEnv): string {
  const isProduction = (env?.NODE_ENV ?? process.env.NODE_ENV) === 'production';

  const value = JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken ?? null,
  });

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`, // 30 days
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function destroyAuthSessionCookie(env?: AuthEnv): string {
  const isProduction = (env?.NODE_ENV ?? process.env.NODE_ENV) === 'production';

  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * App-level users and roles
 */

async function adminRestRequest<T>(
  env: AuthEnv,
  pathWithQuery: string,
  init?: RequestInit,
): Promise<T> {
  const config = getSupabaseConfig(env);

  if (!config.serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be configured for server-side user management');
  }

  const response = await fetch(buildSupabaseUrl(config, `/rest/v1${pathWithQuery}`), {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let json: any = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // leave as empty object
    }
  }

  if (!response.ok) {
    const message = json?.message || json?.error || response.statusText || 'Supabase REST error';
    throw new Error(message);
  }

  return json as T;
}

export async function ensureAppUser(env: AuthEnv, authUser: SupabaseAuthUser): Promise<AppUser> {
  const adminEmails = parseAdminEmailAllowlist(getSupabaseConfig(env).adminEmailAllowlist);

  const desiredRole: AppUserRole = adminEmails.includes(authUser.email.toLowerCase()) ? 'admin' : 'member';

  // Try to find existing user
  const existing = await adminRestRequest<AppUser[]>(
    env,
    `/users?id=eq.${encodeURIComponent(authUser.id)}&select=*`,
  );

  if (existing.length > 0) {
    const user = existing[0];

    // Promote to admin if now allowlisted
    if (desiredRole === 'admin' && user.role !== 'admin') {
      const updated = await adminRestRequest<AppUser[]>(
        env,
        `/users?id=eq.${encodeURIComponent(authUser.id)}`,
        {
          method: 'PATCH',
          headers: {
            Prefer: 'return=representation',
          },
          body: JSON.stringify({ role: 'admin' }),
        },
      );

      if (!updated.length) {
        throw new Error('Failed to promote user to admin');
      }

      return updated[0];
    }

    return user;
  }

  // Create new app user row
  const created = await adminRestRequest<AppUser[]>(env, '/users', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: authUser.id,
      email: authUser.email,
      role: desiredRole,
    }),
  });

  if (!created.length) {
    throw new Error('Failed to create app user');
  }

  return created[0];
}

export async function findAppUserById(env: AuthEnv, id: string): Promise<AppUser | null> {
  const users = await adminRestRequest<AppUser[]>(
    env,
    `/users?id=eq.${encodeURIComponent(id)}&select=*`,
  );

  return users[0] ?? null;
}

export async function listAllAppUsers(env: AuthEnv): Promise<AppUser[]> {
  return adminRestRequest<AppUser[]>(env, '/users?select=*');
}

/**
 * High-level helpers for route loaders/actions
 */

export async function getAppUserFromRequest(
  request: Request,
  env: AuthEnv,
  options: {
    allowDisabled?: boolean;
    createIfMissing?: boolean;
  } = {},
): Promise<{
  appUser: AppUser;
  authUser: SupabaseAuthUser;
  session: AuthSession;
} | null> {
  const session = getAuthSessionFromRequest(request);

  if (!session) {
    return null;
  }

  const authUser = await getSupabaseAuthUserFromSession(env, session);

  const appUser =
    options.createIfMissing === false ? await findAppUserById(env, authUser.id) : await ensureAppUser(env, authUser);

  if (!appUser) {
    return null;
  }

  if (appUser.disabled && !options.allowDisabled) {
    throw new AccountDisabledError('Account disabled');
  }

  return { appUser, authUser, session };
}

export async function requireAppUser(
  request: Request,
  env: AuthEnv,
  options?: { allowDisabled?: boolean },
): Promise<{
  appUser: AppUser;
  authUser: SupabaseAuthUser;
  session: AuthSession;
}> {
  const result = await getAppUserFromRequest(request, env, options);

  if (!result) {
    throw new UnauthorizedError('User is not authenticated');
  }

  return result;
}

export async function requireAdminFromRequest(
  request: Request,
  env: AuthEnv,
): Promise<{
  appUser: AppUser;
  authUser: SupabaseAuthUser;
  session: AuthSession;
}> {
  const result = await requireAppUser(request, env);

  if (result.appUser.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }

  return result;
}