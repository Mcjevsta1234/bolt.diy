export type UserRole = 'admin' | 'member';

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  lastSeen?: string | null;
}

export type FeatureFlagScopeType = 'global' | 'user' | 'workspace';

export interface FeatureFlagRecord {
  key: string;
  enabled: boolean;
  scopeType: FeatureFlagScopeType;
  scopeId?: string | null;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const users = new Map<string, AdminUser>();
const featureFlags = new Map<string, FeatureFlagRecord>();
const auditLog: AuditLogEntry[] = [];

let initialized = false;

function now(): string {
  return new Date().toISOString();
}

function ensureInitialized() {
  if (initialized) {
    return;
  }

  initialized = true;

  // Seed with a default admin user so the dashboard is usable out of the box.
  const seedId = 'admin';
  if (!users.has(seedId)) {
    const timestamp = now();
    users.set(seedId, {
      id: seedId,
      email: 'admin@example.com',
      role: 'admin',
      disabled: false,
      createdAt: timestamp,
      lastSeen: timestamp,
    });
  }
}

export function listUsers(): AdminUser[] {
  ensureInitialized();

  return Array.from(users.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getUserById(userId: string): AdminUser | undefined {
  ensureInitialized();

  return users.get(userId);
}

/**
 * Upsert a user record based on an authenticated identity.
 *
 * This helper allows us to record basic metadata (email, lastSeen) for users
 * that interact with the system without requiring explicit user creation flows.
 */
export function upsertUserFromIdentity(identity: {
  id: string;
  email?: string;
  role?: UserRole;
}): AdminUser {
  ensureInitialized();

  const existing = users.get(identity.id);
  const timestamp = now();

  const updated: AdminUser = {
    id: identity.id,
    email: identity.email ?? existing?.email ?? '',
    role: identity.role ?? existing?.role ?? 'member',
    disabled: existing?.disabled ?? false,
    createdAt: existing?.createdAt ?? timestamp,
    lastSeen: timestamp,
  };

  users.set(updated.id, updated);

  return updated;
}

export function setUserDisabled(actorUserId: string, targetUserId: string, disabled: boolean): AdminUser {
  ensureInitialized();

  const existing = users.get(targetUserId);
  if (!existing) {
    throw new Error('User not found');
  }

  if (existing.disabled === disabled) {
    return existing;
  }

  const updated: AdminUser = { ...existing, disabled };
  users.set(updated.id, updated);

  recordAuditLog({
    actorUserId,
    action: disabled ? 'user_disabled' : 'user_enabled',
    targetType: 'user',
    targetId: targetUserId,
    metadata: {
      previousDisabled: existing.disabled,
      disabled,
    },
  });

  return updated;
}

export function setUserRole(actorUserId: string, targetUserId: string, role: UserRole): AdminUser {
  ensureInitialized();

  const existing = users.get(targetUserId);
  if (!existing) {
    throw new Error('User not found');
  }

  if (existing.role === role) {
    return existing;
  }

  const updated: AdminUser = { ...existing, role };
  users.set(updated.id, updated);

  recordAuditLog({
    actorUserId,
    action: 'user_role_changed',
    targetType: 'user',
    targetId: targetUserId,
    metadata: {
      previousRole: existing.role,
      role,
    },
  });

  return updated;
}

export function listFeatureFlags(filter?: {
  scopeType?: FeatureFlagScopeType;
  scopeId?: string | null;
}): FeatureFlagRecord[] {
  ensureInitialized();

  let flags = Array.from(featureFlags.values());

  if (filter?.scopeType) {
    flags = flags.filter((flag) => flag.scopeType === filter.scopeType);
  }

  if (typeof filter?.scopeId !== 'undefined') {
    flags = flags.filter((flag) => flag.scopeId === filter.scopeId);
  }

  return flags.sort((a, b) => a.key.localeCompare(b.key));
}

export function upsertFeatureFlag(params: {
  actorUserId: string;
  key: string;
  enabled: boolean;
  scopeType?: FeatureFlagScopeType;
  scopeId?: string | null;
}): FeatureFlagRecord {
  ensureInitialized();

  const scopeType = params.scopeType ?? 'global';
  const scopeId = scopeType === 'global' ? null : params.scopeId ?? null;
  const existing = featureFlags.get(params.key);

  const updated: FeatureFlagRecord = {
    key: params.key,
    enabled: params.enabled,
    scopeType,
    scopeId,
    updatedAt: now(),
  };

  featureFlags.set(updated.key, updated);

  recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'feature_flag_updated',
    targetType: 'feature_flag',
    targetId: params.key,
    metadata: {
      previous: existing ?? null,
      updated,
    },
  });

  return updated;
}

export function getEffectiveFeatureFlagState(options: {
  userId?: string;
  workspaceId?: string;
}): Record<string, boolean> {
  ensureInitialized();

  const allFlags = Array.from(featureFlags.values());

  const globalFlags = allFlags.filter((flag) => flag.scopeType === 'global');
  const userFlags = options.userId
    ? allFlags.filter((flag) => flag.scopeType === 'user' && flag.scopeId === options.userId)
    : [];
  const workspaceFlags = options.workspaceId
    ? allFlags.filter((flag) => flag.scopeType === 'workspace' && flag.scopeId === options.workspaceId)
    : [];

  const effective: Record<string, boolean> = {};

  // Global baseline
  for (const flag of globalFlags) {
    effective[flag.key] = flag.enabled;
  }

  // User-specific overrides
  for (const flag of userFlags) {
    effective[flag.key] = flag.enabled;
  }

  // Workspace overrides (highest precedence)
  for (const flag of workspaceFlags) {
    effective[flag.key] = flag.enabled;
  }

  return effective;
}

export function getAuditLog(limit = 100): AuditLogEntry[] {
  ensureInitialized();

  return auditLog.slice(-limit).reverse();
}

export function recordAuditLog(entry: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): AuditLogEntry {
  ensureInitialized();

  const createdAt = now();
  const id = `${createdAt}:${auditLog.length + 1}`;

  const record: AuditLogEntry = {
    id,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
    createdAt,
  };

  auditLog.push(record);

  return record;
}