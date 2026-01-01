import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { Link, useLoaderData } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/Card';

interface LoaderData {
  email: string | null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { getAppUserFromRequest, getAuthEnvFromContext } = await import('../../src/services/auth');

  const env = getAuthEnvFromContext(context);
  const result = await getAppUserFromRequest(request, env, {
    allowDisabled: true,
    createIfMissing: false,
  });

  if (!result || !result.appUser.disabled) {
    // Either not logged in or no longer disabled; send them to the main app/login.
    return redirect(result ? '/' : '/login');
  }

  return json<LoaderData>({
    email: result.appUser.email,
  });
}

export default function AccountDisabledRoute() {
  const data = useLoaderData<LoaderData>();

  return (
    <div className="flex min-h-full items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Account disabled</CardTitle>
            <CardDescription>
              Your account has been disabled by an administrator. You can&apos;t use Bolt until it is re-enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.email && (
              <p className="text-sm text-bolt-elements-textSecondary">
                Signed in as <span className="font-mono text-bolt-elements-textPrimary">{data.email}</span>
              </p>
            )}
            <p className="text-sm text-bolt-elements-textSecondary">
              If you think this is a mistake, contact the instance owner or support team and provide the email address
              associated with your account.
            </p>
            <div className="flex gap-3">
              <form method="post" action="/logout">
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
              <Link
                to="/login"
                className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-bolt-elements-textPrimary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}