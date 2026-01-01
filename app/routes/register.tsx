import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData } from '@remix-run/react';
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

  if (password.length < 8) {
    return json<ActionData>({ error: 'Password must be at least 8 characters long' }, { status: 400 });
  }

  const { signUpWithEmailPassword, getAuthEnvFromContext } = await import('../../src/services/auth');

  const env = getAuthEnvFromContext(context);

  try {
    await signUpWithEmailPassword(env, email, password);

    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('registered', '1');

    return redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error('Registration error', error);

    const message =
      error instanceof Error
        ? error.message
        : 'Unable to register. Please try again or contact support.';

    return json<ActionData>({ error: message }, { status: 400 });
  }
}

export default function RegisterRoute() {
  const actionData = useActionData<ActionData>();

  return (
    <div className="flex min-h-full items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Create your Bolt account</CardTitle>
            <CardDescription>
              Sign up with an email and password to use this Bolt SaaS instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {actionData?.error && (
              <p className="mb-4 text-sm text-bolt-elements-textError">
                {actionData.error}
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
                  minLength={8}
                  autoComplete="new-password"
                  required
                  className="bg-bolt-elements-background"
                />
              </div>
              <Button type="submit" className="w-full">
                Create account
              </Button>
            </Form>
          </CardContent>
          <CardFooter className="flex justify-between text-sm text-bolt-elements-textSecondary">
            <span>Already have an account?</span>
            <Link to="/login" className="text-bolt-elements-textPrimary hover:underline">
              Sign in
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}