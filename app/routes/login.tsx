import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useSearchParams } from '@remix-run/react';
import { useEffect } from 'react';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';

interface ActionData {
  error?: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { getAppUserFromRequest, getAuthEnvFromContext } = await import('../../src/services/auth');

  const env = getAuthEnvFromContext(context);
  const result = await getAppUserFromRequest(request, env, { allowDisabled: true });

  if (result?.appUser && !result.appUser.disabled) {
    return redirect('/');
  }

  if (result?.appUser?.disabled) {
    return redirect('/account-disabled');
  }

  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return json<ActionData>({ error: 'Email and password are required' }, { status: 400 });
  }

  const { signInWithEmailPassword, ensureAppUser, createAuthSessionCookie, getAuthEnvFromContext } = await import(
    '../../src/services/auth'
  );

  const env = getAuthEnvFromContext(context);

  try {
    const { session, authUser } = await signInWithEmailPassword(env, email, password);

    const appUser = await ensureAppUser(env, authUser);
    const setCookie = createAuthSessionCookie(session, env);

    if (appUser.disabled) {
      return redirect('/account-disabled', {
        headers: {
          'Set-Cookie': setCookie,
        },
      });
    }

    return redirect('/', {
      headers: {
        'Set-Cookie': setCookie,
      },
    });
  } catch (error: any) {
    console.error('Login error', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Unable to sign in. Please check your credentials and try again.';

    return json<ActionData>({ error: message }, { status: 400 });
  }
}

export default function LoginRoute() {
  const actionData = useActionData<ActionData>();
  const [searchParams] = useSearchParams();

  const error = actionData?.error ?? searchParams.get('error') ?? undefined;
  const justRegistered = searchParams.get('registered') === '1';

  useEffect(() => {
    if (justRegistered) {
      // Clear URL search params in the browser history
      const url = new URL(window.location.href);
      url.searchParams.delete('registered');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, [justRegistered]);

  return (
    <div className="flex min-h-full items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Sign in to Bolt</CardTitle>
            <CardDescription>
              Use your email and password for this Bolt SaaS instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {justRegistered && !error && (
              <p className="mb-4 text-sm text-bolt-elements-textSecondary">
                Registration successful. You can now sign in with your credentials.
              </p>
            )}
            {error && (
              <p className="mb-4 text-sm text-bolt-elements-textError">
                {error}
              </p>
            )}
            <Form method="post" className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-medium text-bolt-elements-textSecondary"
                >
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="bg-bolt-elements-background"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-medium text-bolt-elements-textSecondary"
                >
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="bg-bolt-elements-background"
                />
              </div>
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </Form>
          </CardContent>
          <CardFooter className="flex justify-between text-sm text-bolt-elements-textSecondary">
            <span>Don&apos;t have an account?</span>
            <Link to="/register" className="text-bolt-elements-textPrimary hover:underline">
              Sign up
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}