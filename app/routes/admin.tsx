import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData, useNavigate } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { requireAdminUser } from '~/lib/.server/auth';
import type {
  AdminUser,
  FeatureFlagRecord,
  AuditLogEntry,
  FeatureFlagScopeType,
} from '~/lib/.server/adminDataStore';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/Tabs';
import { ScrollArea } from '~/components/ui/ScrollArea';
import { Switch } from '~/components/ui/Switch';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';

interface AdminLoaderData {
  // The dashboard UI itself fetches data from API routes, but we still
  // enforce the admin guard on the loader to make the route protected.
  admin: {
    id: string;
    email: string;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Authoritative guard: only admins can access /admin
  // We intentionally avoid pulling admin data directly here so that the
  // API routes remain the single source of truth for mutations.
  const adminUser = requireAdminUser(request);

  return json<AdminLoaderData>({
    admin: {
      id: adminUser.id,
      email: adminUser.email,
    },
  });
}

type AdminTab = 'users' | 'flags' | 'audit';

export default function AdminDashboard() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [flags, setFlags] = useState<FeatureFlagRecord[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);

  const [newFlagKey, setNewFlagKey] = useState('');
  const [newFlagScopeType, setNewFlagScopeType] = useState<FeatureFlagScopeType>('global');
  const [newFlagScopeId, setNewFlagScopeId] = useState('');

  // Initial data fetch from dedicated admin APIs so they remain the
  // authoritative source for admin data.
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [usersRes, flagsRes, auditRes] = await Promise.all([
          fetch('/api/admin/users'),
          fetch('/api/admin/flags'),
          fetch('/api/admin/audit-log'),
        ]);

        if (usersRes.ok) {
          const jsonUsers = (await usersRes.json()) as { users: AdminUser[] };
          setUsers(jsonUsers.users);
        }

        if (flagsRes.ok) {
          const jsonFlags = (await flagsRes.json()) as { flags: FeatureFlagRecord[] };
          setFlags(jsonFlags.flags);
        }

        if (auditRes.ok) {
          const jsonAudit = (await auditRes.json()) as { entries: AuditLogEntry[] };
          setAuditLog(jsonAudit.entries);
        }
      } catch (error) {
        console.error('Failed to load admin data', error);
        toast.error('Failed to load admin data');
      }
    };

    void fetchInitialData();
  }, []);

  // Simple helper to refetch audit logs after mutations
  const refreshAuditLog = async () => {
    try {
      const res = await fetch('/api/admin/audit-log');
      if (!res.ok) return;
      const jsonData = (await res.json()) as { entries: AuditLogEntry[] };
      setAuditLog(jsonData.entries);
    } catch (error) {
      console.error('Failed to refresh audit log', error);
    }
  };

  const handleToggleUserDisabled = async (userId: string, disabled: boolean) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, disabled } : u)));

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setDisabled', userId, disabled }),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const jsonData = (await res.json()) as { user: AdminUser };
      setUsers((prev) => prev.map((u) => (u.id === jsonData.user.id ? jsonData.user : u)));
      toast.success(`User ${disabled ? 'disabled' : 'enabled'}`);
      await refreshAuditLog();
    } catch (error) {
      console.error('Failed to update user disabled state', error);
      toast.error('Failed to update user state');
      // revert optimistic update
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, disabled: !disabled } : u)));
    }
  };

  const handleChangeUserRole = async (userId: string, role: AdminUser['role']) => {
    const previous = users.find((u) => u.id === userId)?.role;
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setRole', userId, role }),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const jsonData = (await res.json()) as { user: AdminUser };
      setUsers((prev) => prev.map((u) => (u.id === jsonData.user.id ? jsonData.user : u)));
      toast.success(`User role updated to ${role}`);
      await refreshAuditLog();
    } catch (error) {
      console.error('Failed to update user role', error);
      toast.error('Failed to update user role');
      if (previous) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: previous } : u)));
      }
    }
  };

  const handleToggleFlag = async (flag: FeatureFlagRecord, enabled: boolean) => {
    setFlags((prev) =>
      prev.map((f) => (f.key === flag.key && f.scopeType === flag.scopeType && f.scopeId === flag.scopeId ? { ...f, enabled } : f)),
    );

    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          key: flag.key,
          enabled,
          scopeType: flag.scopeType,
          scopeId: flag.scopeId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const jsonData = (await res.json()) as { flag: FeatureFlagRecord };
      setFlags((prev) =>
        prev.map((f) =>
          f.key === jsonData.flag.key && f.scopeType === jsonData.flag.scopeType && f.scopeId === jsonData.flag.scopeId
            ? jsonData.flag
            : f,
        ),
      );
      toast.success('Feature flag updated');
      await refreshAuditLog();
    } catch (error) {
      console.error('Failed to update feature flag', error);
      toast.error('Failed to update feature flag');
      // revert optimistic update
      setFlags((prev) =>
        prev.map((f) =>
          f.key === flag.key && f.scopeType === flag.scopeType && f.scopeId === flag.scopeId ? { ...f, enabled: flag.enabled } : f,
        ),
      );
    }
  };

  const handleCreateFlag = async () => {
    const trimmedKey = newFlagKey.trim();
    if (!trimmedKey) {
      toast.error('Flag key is required');
      return;
    }

    const optimisticFlag: FeatureFlagRecord = {
      key: trimmedKey,
      enabled: true,
      scopeType: newFlagScopeType,
      scopeId: newFlagScopeType === 'global' ? null : newFlagScopeId.trim() || null,
      updatedAt: new Date().toISOString(),
    };

    setFlags((prev) => [...prev, optimisticFlag]);

    try {
      const res = await fetch('/api/admin/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          key: optimisticFlag.key,
          enabled: optimisticFlag.enabled,
          scopeType: optimisticFlag.scopeType,
          scopeId: optimisticFlag.scopeId,
        }),
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const jsonData = (await res.json()) as { flag: FeatureFlagRecord };

      setFlags((prev) =>
        prev.map((f) =>
          f.key === optimisticFlag.key &&
          f.scopeType === optimisticFlag.scopeType &&
          f.scopeId === optimisticFlag.scopeId
            ? jsonData.flag
            : f,
        ),
      );

      setNewFlagKey('');
      setNewFlagScopeId('');
      setNewFlagScopeType('global');
      toast.success('Feature flag created');
      await refreshAuditLog();
    } catch (error) {
      console.error('Failed to create feature flag', error);
      toast.error('Failed to create feature flag');
      setFlags((prev) =>
        prev.filter(
          (f) =>
            !(
              f.key === optimisticFlag.key &&
              f.scopeType === optimisticFlag.scopeType &&
              f.scopeId === optimisticFlag.scopeId
            ),
        ),
      );
    }
  };

  // If /admin ever needs navigation guards (for example, redirect on logout),
  // this hook is where we'd add them.
  useEffect(() => {
    // Placeholder for future logic
  }, [navigate]);

  const renderUsersTab = () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Users</h2>
        <p className="text-sm text-bolt-elements-textSecondary">
          Manage user roles and disable accounts. Changes take effect immediately for future requests.
        </p>
      </div>

      <div className="border border-bolt-elements-border rounded-lg overflow-hidden bg-bolt-elements-background-depth-1">
        <div className="grid grid-cols-[2fr,2fr,1fr,1fr,1.5fr] px-4 py-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2">
          <div>Email</div>
          <div>User ID</div>
          <div>Role</div>
          <div>Disabled</div>
          <div>Created / Last seen</div>
        </div>
        <ScrollArea className="max-h-[400px]">
          <div className="divide-y divide-bolt-elements-border">
            {users.map((user) => (
              <div
                key={user.id}
                className={classNames(
                  'grid grid-cols-[2fr,2fr,1fr,1fr,1.5fr] px-4 py-3 text-sm items-center',
                  user.disabled ? 'opacity-60' : '',
                )}
              >
                <div className="truncate pr-2">{user.email || '—'}</div>
                <div className="truncate pr-2 font-mono text-xs text-bolt-elements-textSecondary">{user.id}</div>
                <div className="flex items-center gap-2">
                  <select
                    className="bg-bolt-elements-background-depth-1 border border-bolt-elements-border rounded px-2 py-1 text-xs"
                    value={user.role}
                    onChange={(e) => handleChangeUserRole(user.id, e.target.value as AdminUser['role'])}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <Switch
                    checked={user.disabled}
                    onCheckedChange={(checked) => handleToggleUserDisabled(user.id, checked)}
                  />
                </div>
                <div className="flex flex-col text-xs text-bolt-elements-textSecondary">
                  <span>{new Date(user.createdAt).toLocaleString()}</span>
                  {user.lastSeen && <span className="opacity-75">Last seen: {new Date(user.lastSeen).toLocaleString()}</span>}
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-bolt-elements-textSecondary">No users found.</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );

  const renderFlagsTab = () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Feature flags</h2>
          <p className="text-sm text-bolt-elements-textSecondary">
            Server-authoritative flags used to control access to features like MCP.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border border-bolt-elements-border rounded-lg p-4 bg-bolt-elements-background-depth-1">
        <div className="grid grid-cols-1 md:grid-cols-[2fr,1fr,1fr,auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-bolt-elements-textSecondary mb-1">Key</label>
            <Input
              value={newFlagKey}
              onChange={(e) => setNewFlagKey(e.target.value)}
              placeholder="mcp.enabled"
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-bolt-elements-textSecondary mb-1">Scope</label>
            <select
              className="bg-bolt-elements-background-depth-1 border border-bolt-elements-border rounded px-2 py-2 text-sm w-full"
              value={newFlagScopeType}
              onChange={(e) => setNewFlagScopeType(e.target.value as FeatureFlagScopeType)}
            >
              <option value="global">Global</option>
              <option value="user">User</option>
              <option value="workspace">Workspace</option>
            </select>
          </div>
          {newFlagScopeType !== 'global' && (
            <div>
              <label className="block text-xs font-medium text-bolt-elements-textSecondary mb-1">
                {newFlagScopeType === 'user' ? 'User ID' : 'Workspace ID'}
              </label>
              <Input
                value={newFlagScopeId}
                onChange={(e) => setNewFlagScopeId(e.target.value)}
                placeholder={newFlagScopeType === 'user' ? 'user-uuid' : 'workspace-id'}
                className="text-sm"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={handleCreateFlag} className="mt-4">
              Add flag
            </Button>
          </div>
        </div>
      </div>

      <div className="border border-bolt-elements-border rounded-lg overflow-hidden bg-bolt-elements-background-depth-1">
        <div className="grid grid-cols-[2fr,1fr,2fr,auto,auto] px-4 py-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2">
          <div>Key</div>
          <div>Enabled</div>
          <div>Scope</div>
          <div>Updated</div>
          <div></div>
        </div>
        <ScrollArea className="max-h-[400px]">
          <div className="divide-y divide-bolt-elements-border">
            {flags.map((flag) => (
              <div
                key={`${flag.key}:${flag.scopeType}:${flag.scopeId ?? 'null'}`}
                className="grid grid-cols-[2fr,1fr,2fr,auto,auto] px-4 py-3 text-sm items-center"
              >
                <div className="font-mono text-xs truncate pr-2">{flag.key}</div>
                <div>
                  <Switch checked={flag.enabled} onCheckedChange={(checked) => handleToggleFlag(flag, checked)} />
                </div>
                <div className="text-xs text-bolt-elements-textSecondary">
                  {flag.scopeType === 'global'
                    ? 'Global'
                    : `${flag.scopeType === 'user' ? 'User' : 'Workspace'}: ${flag.scopeId ?? '—'}`}
                </div>
                <div className="text-xs text-bolt-elements-textSecondary">
                  {flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : '—'}
                </div>
                <div />
              </div>
            ))}
            {flags.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-bolt-elements-textSecondary">No feature flags defined.</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );

  const renderAuditTab = () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">Audit log</h2>
        <p className="text-sm text-bolt-elements-textSecondary">
          All admin actions are recorded for accountability.
        </p>
      </div>

      <div className="border border-bolt-elements-border rounded-lg overflow-hidden bg-bolt-elements-background-depth-1">
        <div className="grid grid-cols-[1.7fr,1.5fr,1.2fr,1.2fr,3fr] px-4 py-2 text-xs font-medium uppercase tracking-wide text-bolt-elements-textSecondary bg-bolt-elements-background-depth-2">
          <div>When</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Target</div>
          <div>Metadata</div>
        </div>
        <ScrollArea className="max-h-[400px]">
          <div className="divide-y divide-bolt-elements-border">
            {auditLog.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1.7fr,1.5fr,1.2fr,1.2fr,3fr] px-4 py-3 text-xs items-start"
              >
                <div className="text-bolt-elements-textSecondary">{new Date(entry.createdAt).toLocaleString()}</div>
                <div className="font-mono truncate pr-2">{entry.actorUserId}</div>
                <div className="font-semibold">{entry.action}</div>
                <div className="truncate">
                  {entry.targetType}:{' '}
                  <span className="font-mono">{entry.targetId}</span>
                </div>
                <div className="font-mono text-[11px] whitespace-pre-wrap break-all max-h-[80px] overflow-hidden">
                  {Object.keys(entry.metadata || {}).length ? JSON.stringify(entry.metadata) : '—'}
                </div>
              </div>
            ))}
            {auditLog.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-bolt-elements-textSecondary">
                No audit entries yet. Changes to users and feature flags will appear here.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <main className="flex-1 flex flex-col px-6 pb-6 pt-2 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">Admin dashboard</h1>
            <p className="text-sm text-bolt-elements-textSecondary">
              Manage users, feature flags, and review audit logs.
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AdminTab)}>
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="flags">Feature flags</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <TabsContent value="users">{renderUsersTab()}</TabsContent>
            <TabsContent value="flags">{renderFlagsTab()}</TabsContent>
            <TabsContent value="audit">{renderAuditTab()}</TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}