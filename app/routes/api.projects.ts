import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.projects');

function getSupabaseEnv(context: any) {
  const env = context?.cloudflare?.env as Env | undefined;

  if (!env?.SAAS_SUPABASE_URL || !env?.SAAS_SUPABASE_SERVICE_ROLE_KEY || !env?.SAAS_SUPABASE_STORAGE_BUCKET) {
    return null;
  }

  return {
    url: env.SAAS_SUPABASE_URL,
    serviceKey: env.SAAS_SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function listProjectsLoader({ context, request }: LoaderFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    // Remote persistence not configured; return empty list so callers can fall back to local.
    return json({ projects: [] }, { status: 200 });
  }

  try {
    const url = new URL('/rest/v1/projects', supabase.url);

    // For now we fetch all projects visible to the service role. The SaaS
    // application is expected to introduce proper user scoping (e.g. via
    // headers or an owner_id filter) in a follow-up iteration.
    url.searchParams.set('select', 'id,owner_id,name,created_at,updated_at,deleted_at');
    url.searchParams.set('order', 'created_at.desc');

    const response = await fetch(url.toString(), {
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Failed to list projects from Supabase', { status: response.status, text });
      return json({ error: 'Failed to list projects' }, { status: 500 });
    }

    const rows = (await response.json()) as {
      id: string;
      owner_id: string;
      name: string;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }[];

    const projects = rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));

    return json({ projects }, { status: 200 });
  } catch (error) {
    logger.error('Unexpected error listing projects', error);
    return json({ error: 'Unexpected error listing projects' }, { status: 500 });
  }
}

async function createProjectAction({ request, context }: ActionFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    return json({ error: 'Remote persistence is not configured' }, { status: 501 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return json({ error: 'Project name is required' }, { status: 400 });
    }

    const url = new URL('/rest/v1/projects', supabase.url);
    url.searchParams.set('select', 'id,owner_id,name,created_at,updated_at,deleted_at');

    // NOTE: owner_id is intentionally omitted here – the SaaS auth layer
    // should populate it via database defaults or triggers based on auth.uid().
    const insertPayload = {
      name,
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(insertPayload),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Failed to create project in Supabase', { status: response.status, text });
      return json({ error: 'Failed to create project' }, { status: 500 });
    }

    const [row] = (await response.json()) as {
      id: string;
      owner_id: string;
      name: string;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }[];

    const project = {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };

    return json({ project }, { status: 201 });
  } catch (error) {
    logger.error('Unexpected error creating project', error);
    return json({ error: 'Unexpected error creating project' }, { status: 500 });
  }
}

export const loader = withSecurity(listProjectsLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

export const action = withSecurity(createProjectAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});