export type FeatureFlagScopeType = 'global' | 'user' | 'workspace';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  scopeType: FeatureFlagScopeType;
  scopeId?: string | null;
  updatedAt?: string | Date;
}

export type EffectiveFeatureFlags = Record<string, boolean>;

/**
 * Merge feature flags from different scopes into a single effective map.
 *
 * This utility is intentionally flexible so it can be reused in different
 * code paths (server or client) without coupling to a specific persistence
 * layer. It supports multiple call patterns:
 *
 * 1. Arrays (ordered by precedence):
 *    getEffectiveFlags(globalFlags, userFlags, workspaceFlags)
 *
 * 2. Object bag:
 *    getEffectiveFlags({ global: [...], user: [...], workspace: [...] })
 *
 * Later sources override earlier ones for the same flag key.
 */
export function getEffectiveFlags(...args: any[]): EffectiveFeatureFlags {
  let globalFlags: FeatureFlag[] = [];
  let userFlags: FeatureFlag[] = [];
  let workspaceFlags: FeatureFlag[] = [];

  if (args.length === 1) {
    const input = args[0];
    if (Array.isArray(input)) {
      // Single array – treat everything as global
      globalFlags = input;
    } else if (input && typeof input === 'object') {
      globalFlags = Array.isArray(input.global) ? input.global : [];
      userFlags = Array.isArray(input.user) ? input.user : [];
      workspaceFlags = Array.isArray(input.workspace) ? input.workspace : [];
    }
  } else if (args.length > 1) {
    globalFlags = Array.isArray(args[0]) ? args[0] : [];
    userFlags = Array.isArray(args[1]) ? args[1] : [];
    workspaceFlags = Array.isArray(args[2]) ? args[2] : [];
  }

  const effective: EffectiveFeatureFlags = {};

  // Global baseline
  for (const flag of globalFlags) {
    effective[flag.key] = !!flag.enabled;
  }

  // User-specific overrides
  for (const flag of userFlags) {
    effective[flag.key] = !!flag.enabled;
  }

  // Workspace overrides (highest precedence)
  for (const flag of workspaceFlags) {
    effective[flag.key] = !!flag.enabled;
  }

  return effective;
}