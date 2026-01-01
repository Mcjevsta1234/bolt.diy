import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService } from '~/lib/services/mcpService';
import { buildConfigFromPolicy, getMcpPolicy } from '~/lib/services/mcpPolicy';

const logger = createScopedLogger('api.mcp-update-config');

/**
 * This endpoint now enforces the server-side MCP policy and ignores any
 * client-supplied configuration. It exists primarily for backwards
 * compatibility and internal administration flows.
 */
export async function action({ context }: ActionFunctionArgs) {
  try {
    const policy = getMcpPolicy(context?.cloudflare?.env as any);

    if (!policy.mcpEnabled) {
      return Response.json({ error: 'MCP is disabled' }, { status: 403 });
    }

    const config = buildConfigFromPolicy(policy);
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(config);

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}
