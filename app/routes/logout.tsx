import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { redirect } from '@remix-run/cloudflare';

export async function loader({ context }: LoaderFunctionArgs) {
  const { destroyAuthSessionCookie, getAuthEnvFromContext } = await import('../../src/services/auth');
  const env = getAuthEnvFromContext(context);
  const cookie = destroyAuthSessionCookie(env);

  return redirect('/login', {
    headers: {
      'Set-Cookie': cookie,
    },
  });
}

export async function action({ context }: ActionFunctionArgs) {
  const { destroyAuthSessionCookie, getAuthEnvFromContext } = await import('../../src/services/auth');
  const env = getAuthEnvFromContext(context);
  const cookie = destroyAuthSessionCookie(env);

  return redirect('/login', {
    headers: {
      'Set-Cookie': cookie,
    },
  });
}