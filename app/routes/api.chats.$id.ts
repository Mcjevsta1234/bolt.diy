import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.chats.$id');

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

async function getChatLoader({ params, context }: LoaderFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    return json({ chat: null, messages: [] }, { status: 200 });
  }

  const chatId = params.id;

  if (!chatId) {
    return json({ error: 'Missing chat id' }, { status: 400 });
  }

  try {
    // Fetch chat row
    const chatUrl = new URL('/rest/v1/chats', supabase.url);
    chatUrl.searchParams.set('select', 'id,owner_id,project_id,title,created_at,updated_at');
    chatUrl.searchParams.set('id', `eq.${chatId}`);

    const chatResponse = await fetch(chatUrl.toString(), {
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!chatResponse.ok) {
      const text = await chatResponse.text();
      logger.error('Failed to fetch chat row from Supabase', { status: chatResponse.status, text });
      return json({ error: 'Failed to load chat' }, { status: 500 });
    }

    const chatRows = (await chatResponse.json()) as {
      id: string;
      owner_id: string | null;
      project_id: string | null;
      title: string | null;
      created_at: string;
      updated_at: string;
    }[];

    if (!chatRows.length) {
      return json({ chat: null, messages: [] }, { status: 404 });
    }

    const chatRow = chatRows[0];

    const chat = {
      id: chatRow.id,
      ownerId: chatRow.owner_id ?? '',
      projectId: chatRow.project_id,
      title: chatRow.title,
      createdAt: chatRow.created_at,
      updatedAt: chatRow.updated_at,
    };

    // Fetch messages
    const messagesUrl = new URL('/rest/v1/chat_messages', supabase.url);
    messagesUrl.searchParams.set('select', 'id,chat_id,role,content,metadata_json,created_at');
    messagesUrl.searchParams.set('chat_id', `eq.${chatRow.id}`);
    messagesUrl.searchParams.set('order', 'created_at.asc');

    const messagesResponse = await fetch(messagesUrl.toString(), {
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!messagesResponse.ok) {
      const text = await messagesResponse.text();
      logger.error('Failed to fetch chat messages from Supabase', {
        status: messagesResponse.status,
        text,
      });
      return json({ error: 'Failed to load chat messages' }, { status: 500 });
    }

    const rows = (await messagesResponse.json()) as {
      id: string;
      chat_id: string;
      role: string;
      content: string;
      metadata_json: unknown | null;
      created_at: string;
    }[];

    const messages = rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
    }));

    return json(
      {
        chat,
        messages,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('Unexpected error loading chat', error);
    return json({ error: 'Unexpected error loading chat' }, { status: 500 });
  }
}

export const loader = withSecurity(getChatLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});