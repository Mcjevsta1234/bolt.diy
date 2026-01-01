import { useEffect, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';
import { useMCPStore } from '~/lib/stores/mcp';
import McpServerList from '~/components/@settings/tabs/mcp/McpServerList';

export default function McpTab() {
  const settings = useMCPStore((state) => state.settings);
  const isInitialized = useMCPStore((state) => state.isInitialized);
  const serverTools = useMCPStore((state) => state.serverTools);
  const initialize = useMCPStore((state) => state.initialize);
  const updateSettings = useMCPStore((state) => state.updateSettings);
  const checkServersAvailabilities = useMCPStore((state) => state.checkServersAvailabilities);

  const [isSaving, setIsSaving] = useState(false);
  const [maxLLMSteps, setMaxLLMSteps] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingServers, setIsCheckingServers] = useState(false);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      initialize().catch((err) => {
        setError(`Failed to initialize MCP settings: ${err instanceof Error ? err.message : String(err)}`);
        toast.error('Failed to load MCP settings');
      });
    }
  }, [isInitialized, initialize]);

  useEffect(() => {
    setMaxLLMSteps(settings.maxLLMSteps);
    setError(null);
  }, [settings]);

  const handleMaxLLMCallChange = (value: string) => {
    setMaxLLMSteps(parseInt(value, 10));
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await updateSettings({
        maxLLMSteps,
      });
      toast.success('MCP settings saved');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save MCP settings');
      toast.error('Failed to save MCP settings');
    } finally {
      setIsSaving(false);
    }
  };

  const checkServerAvailability = async () => {
    setIsCheckingServers(true);
    setError(null);

    try {
      await checkServersAvailabilities();
    } catch (e) {
      setError(`Failed to check server availability: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsCheckingServers(false);
    }
  };

  const toggleServerExpanded = (serverName: string) => {
    setExpandedServer(expandedServer === serverName ? null : serverName);
  };

  const serverEntries = useMemo(() => Object.entries(serverTools), [serverTools]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <section aria-labelledby="server-status-heading">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-medium text-bolt-elements-textPrimary">MCP Servers</h2>
          <button
            onClick={checkServerAvailability}
            disabled={isCheckingServers}
            className={classNames(
              'px-3 py-1.5 rounded-lg text-sm',
              'bg-bolt-elements-background-depth-3 hover:bg-bolt-elements-background-depth-4',
              'text-bolt-elements-textPrimary',
              'transition-all duration-200',
              'flex items-center gap-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isCheckingServers ? (
              <div className="i-svg-spinners:90-ring-with-bg w-3 h-3 text-bolt-elements-loader-progress animate-spin" />
            ) : (
              <div className="i-ph:arrow-counter-clockwise w-3 h-3" />
            )}
            Check availability
          </button>
        </div>

        {serverEntries.length === 0 ? (
          <p className="text-sm text-bolt-elements-textSecondary">
            No MCP servers are currently available. Server configuration is managed by the administrator and cannot be
            changed from this client.
          </p>
        ) : (
          <McpServerList
            checkingServers={isCheckingServers}
            expandedServer={expandedServer}
            serverEntries={serverEntries}
            toggleServerExpanded={toggleServerExpanded}
          />
        )}
      </section>

      <section aria-labelledby="config-section-heading">
        <h2 className="text-base font-medium text-bolt-elements-textPrimary mb-3">Runtime settings</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="max-llm-steps" className="block text-sm text-bolt-elements-textSecondary mb-2">
              Maximum number of sequential LLM calls (steps)
            </label>
            <input
              id="max-llm-steps"
              type="number"
              placeholder="Maximum number of sequential LLM calls"
              min="1"
              max="20"
              value={maxLLMSteps}
              onChange={(e) => handleMaxLLMCallChange(e.target.value)}
              className="w-full px-3 py-2 text-bolt-elements-textPrimary text-sm rounded-lg bg-white dark:bg-bolt-elements-background-depth-4 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor-dark focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="mt-2 text-sm text-bolt-elements-textSecondary">
            MCP server definitions are centrally managed by the service and cannot be edited from this interface.
            Clients can only use servers that are present in the backend allowlist.
          </div>
          {error && <p className="mt-2 text-sm text-bolt-elements-icon-error">{error}</p>}
        </div>
      </section>

      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={isSaving}
          aria-disabled={isSaving}
          className={classNames(
            'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
            'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent',
            'hover:bg-bolt-elements-item-backgroundActive',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <div className="i-ph:floppy-disk w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
