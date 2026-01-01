import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.chats');

function getSupabaseEnv(context: any) {
  const env = context?.cloudflare?.env as Env | undefined;

  if (!env?.SAAS_SUPABASE_URL || !env?.SAAS_SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return {
    url: env.SAAS_SUPABASE_URL,
    serviceKey: env.SAAS_SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Upsert chat + messages.
 *
 * This endpoint is intentionally simple: it receives the full array of
 * messages and replaces the remote representation with that array. This keeps
 * the semantics aligned with the existing IndexedDB persistence where we treat
 * the message list as the source of truth.
 */
async function upsertChatAction({ request, context }: ActionFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    // Remote persistence not configured; callers should silently fall back to local.
    return json({ skipped: true }, { status: 200 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    const chatId = typeof body.chatId === 'string' ? body.chatId : '';
    const projectId = typeof body.projectId === 'string' ? body.projectId : null;
    const title = typeof body.title === 'string' ? body.title : null;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    // Step 1: ensure chat row exists (upsert by id)
    const chatsUrl = new URL('/rest/v1/chats', supabase.url);
    chatsUrl.searchParams.set('select', 'id,owner_id,project_id,title,created_at,updated_at');

    const chatPayload = {
      id: chatId,
      project_id: projectId,
      title,
    };

    const chatResponse = await fetch(chatsUrl.toString(), {
      method: 'POST',
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(chatPayload),
    });

    if (!chatResponse.ok) {
      const text = await chatResponse.text();
      logger.error('Failed to upsert chat row', { status: chatResponse.status, text });
      return json({ error: 'Failed to persist chat metadata' }, { status: 500 });
    }

    const [chatRow] = (await chatResponse.json()) as {
      id: string;
      owner_id: string | null;
      project_id: string | null;
      title: string | null;
      created_at: string;
      updated_at: string;
    }[];

    // Step 2: replace chat_messages with the provided messages
    // For now, we use a simple "delete then insert" strategy.
    const deleteUrl = new URL('/rest/v1/chat_messages', supabase.url);
    deleteUrl.searchParams.set('chat_id', `eq.${chatRow.id}`);

    const deleteResponse = await fetch(deleteUrl.toString(), {
      method: 'DELETE',
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!deleteResponse.ok) {
      const text = await deleteResponse.text();
      logger.error('Failed to clear chat_messages for chat', { status: deleteResponse.status, text });
      return json({ error: 'Failed to reset chat messages' }, { status: 500 });
    }

    if (messages.length > 0) {
      const insertUrl = new URL('/rest/v1/chat_messages', supabase.url);
      const payload = messages.map(
        (m: {
          id: string;
          role: string;
          content: string;
          metadata?: unknown;
          createdAt?: string;
        }) => ({
          id: m.id,
          chat_id: chatRow.id,
          role: m.role,
          content: m.content,
          metadata_json: m.metadata ?? null,
          created_at: m.createdAt ?? new Date().toISOString(),
        }),
      );

      const insertResponse = await fetch(insertUrl.toString(), {
        method: 'POST',
        headers: {
          apikey: supabase.serviceKey,
          Authorization: `Bearer ${supabase.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!insertResponse.ok) {
        const text = await insertResponse.text();
        logger.error('Failed to insert chat messages', { status: insertResponse.status, text });
        return json({ error: 'Failed to persist chat messages' }, { status: 500 });
      }
    }

    return json({ ok: true }, { status: 200 });
  } catch (error) {
    logger.error('Unexpected error upserting chat', error);
    return json({ error: 'Unexpected error upserting chat' }, { status: 500 });
  }
}

export const action = withSecurity(upsertChatAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});