/**
 * MCP Policy Service
 * 
 * Server-side MCP policy enforcement.
 * Returns allowed MCP servers based on environment configuration.
 */

import type { MCPConfig } from '~/lib/services/mcpService';

export interface MCPPolicy {
  mcpEnabled: boolean;
  allowedServers: Record<string, any>;
}

/**
 * Get MCP policy from environment
 */
export function getMcpPolicy(env: any): MCPPolicy {
  // For now, return a permissive policy
  // TODO: Implement proper allowlist from database/environment
  return {
    mcpEnabled: true,
    allowedServers: {
      // Default allowed servers
      filesystem: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    },
  };
}

/**
 * Build MCP config from policy
 */
export function buildConfigFromPolicy(policy: MCPPolicy): MCPConfig {
  if (!policy.mcpEnabled) {
    return { mcpServers: {} };
  }

  return {
    mcpServers: policy.allowedServers,
  };
}
