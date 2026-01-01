import { create } from 'zustand';
import type { MCPServerTools } from '~/lib/services/mcpService';

const MCP_SETTINGS_KEY = 'mcp_settings';
const isBrowser = typeof window !== 'undefined';

type MCPSettings = {
  /**
   * Maximum number of sequential LLM steps when using MCP tools.
   * This is a purely client-side preference and does not contain any server URLs.
   */
  maxLLMSteps: number;
};

const defaultSettings: MCPSettings = {
  maxLLMSteps: 5,
};

type Store = {
  isInitialized: boolean;
  settings: MCPSettings;
  serverTools: MCPServerTools;
  error: string | null;
  isUpdatingConfig: boolean;
};

type Actions = {
  initialize: () => Promise<void>;
  updateSettings: (settings: MCPSettings) => Promise<void>;
  checkServersAvailabilities: () => Promise<void>;
};

export const useMCPStore = create<Store & Actions>((set, get) => ({
  isInitialized: false,
  settings: defaultSettings,
  serverTools: {},
  error: null,
  isUpdatingConfig: false,
  initialize: async () => {
    if (get().isInitialized) {
      return;
    }

    if (isBrowser) {
      const savedSettings = localStorage.getItem(MCP_SETTINGS_KEY);

      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings) as Partial<MCPSettings>;

          set(() => ({
            settings: {
              maxLLMSteps:
                typeof parsed.maxLLMSteps === 'number' && parsed.maxLLMSteps > 0
                  ? parsed.maxLLMSteps
                  : defaultSettings.maxLLMSteps,
            },
          }));
        } catch (error) {
          console.error('Error parsing saved MCP settings:', error);
          set(() => ({
            error: `Error parsing saved MCP settings: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      } else {
        localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(defaultSettings));
      }
    }

    // Try to load the current server status from the backend once on initialization.
    try {
      await get().checkServersAvailabilities();
    } catch (error) {
      // Surface the error but don't block initialization.
      set(() => ({
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    set(() => ({ isInitialized: true }));
  },
  updateSettings: async (newSettings: MCPSettings) => {
    if (get().isUpdatingConfig) {
      return;
    }

    try {
      set(() => ({ isUpdatingConfig: true }));

      if (isBrowser) {
        localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(newSettings));
      }

      set(() => ({ settings: newSettings }));
    } finally {
      set(() => ({ isUpdatingConfig: false }));
    }
  },
  checkServersAvailabilities: async () => {
    const response = await fetch('/api/mcp-check', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }

    const serverTools = (await response.json()) as MCPServerTools;

    set(() => ({ serverTools }));
  },
}));
