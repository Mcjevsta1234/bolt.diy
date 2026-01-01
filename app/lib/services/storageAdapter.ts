import type { FileMap } from '~/lib/stores/files';

/**
 * Lightweight types that mirror the SaaS Supabase schema defined in
 * `supabase/migrations/20250101000000_remote_projects_chats.sql`.
 */

export interface CloudProject {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CloudProjectVersion {
  id: string;
  projectId: string;
  versionNum: number;
  storagePath: string;
  checksum: string | null;
  createdAt: string;
}

export interface CloudChat {
  id: string;
  ownerId: string;
  projectId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadataJson: unknown | null;
  createdAt: string;
}

export interface SaveSnapshotParams {
  projectId: string;
  /**
   * Serialized file map from the WebContainer. We intentionally keep the shape
   * aligned with FileMap so the caller does not need to transform it.
   */
  files: FileMap;
  /**
   * Optional checksum of the snapshot contents (e.g. SHA-256 of the zip).
   * The adapter does not compute this by default; if the caller wants a
   * deterministic checksum, it should compute one and pass it here.
   */
  checksum?: string;
  /**
   * Optional human readable description or summary. This is stored in the
   * DB-side metadata (currently as part of project_versions.checksum or in
   * future metadata columns).
   */
  summary?: string;
}

/**
 * Storage adapter interface.
 *
 * The goal is to make persistence pluggable:
 *  - Local adapter: browser-only (IndexedDB / localStorage)
 *  - Remote adapter: Supabase-backed SaaS persistence
 *
 * Only the remote adapter is implemented here. Local persistence continues to
 * live in `app/lib/persistence/*`.
 */
export interface StorageAdapter {
  listProjects(): Promise<CloudProject[]>;
  createProject(name: string): Promise<CloudProject>;

  /**
   * Save a new snapshot (project version) for an existing project.
   * Implementations are responsible for:
   *   - Archiving the FileMap into a binary format (zip/tar)
   *   - Uploading the binary to blob storage (Supabase Storage)
   *   - Creating a project_versions row pointing at the blob
   */
  saveProjectSnapshot(params: SaveSnapshotParams): Promise<CloudProjectVersion>;

  /**
   * Fetch a snapshot for a given version and return the hydrated FileMap so
   * callers can re-populate the WebContainer file system.
   */
  loadProjectSnapshot(projectId: string, versionNum: number): Promise<FileMap>;

  /**
   * Persist a chat and its messages for a given project.
   *
   * This mirrors the shape of the in-memory chat history:
   *  - chatId is a stable identifier used by the UI (e.g. URL segment)
   *  - messages is the full ordered array; the adapter can choose whether to
   *    replace or upsert individual rows.
   */
  saveChat(params: {
    chatId: string;
    projectId: string | null;
    title: string | null;
    messages: {
      id: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: unknown;
      createdAt?: string;
    }[];
  }): Promise<void>;

  /**
   * Load a chat (and its messages) by its external identifier.
   */
  loadChat(chatId: string): Promise<{
    chat: CloudChat | null;
    messages: CloudChatMessage[];
  }>;
}

/**
 * RemoteStorageAdapter
 *
 * Client-side adapter that talks to Remix API routes which in turn call
 * Supabase (using the SAAS_SUPABASE_* environment variables).
 *
 * This class is intentionally thin: all Supabase-specific logic lives in the
 * server routes so that secrets never reach the browser.
 */
export class RemoteStorageAdapter implements StorageAdapter {
  /**
   * Feature flag: remote persistence is considered enabled only when this
   * environment variable is truthy. This keeps the open-source / local build
   * free from accidental Supabase calls.
   */
  static get isEnabled(): boolean {
    // The Vite env may be undefined in tests or on the server.
    if (typeof import.meta === 'undefined' || !('env' in import.meta)) {
      return false;
    }

    const flag = (import.meta as any).env?.VITE_REMOTE_PERSISTENCE_ENABLED;
    return flag === 'true' || flag === '1';
  }

  /**
   * Singleton-style accessor so callers don't create multiple adapters.
   * Returns null when remote persistence is disabled.
   */
  static get instance(): RemoteStorageAdapter | null {
    if (!RemoteStorageAdapter.isEnabled) {
      return null;
    }

    if (typeof window === 'undefined') {
      // Remote adapter is only meaningful in the browser; server-side logic
      // should go through Remix loaders/actions directly.
      return null;
    }

    if (!(window as any).__remoteStorageAdapter) {
      (window as any).__remoteStorageAdapter = new RemoteStorageAdapter();
    }

    return (window as any).__remoteStorageAdapter;
  }

  private async _request<T>(
    input: RequestInfo,
    init?: RequestInit & { expectedStatus?: number | number[] },
  ): Promise<T> {
    const expected = init?.expectedStatus ?? [200, 201, 204];
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];

    const response = await fetch(input, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!expectedStatuses.includes(response.status)) {
      let message = `Remote storage request failed with status ${response.status}`;
      try {
        const json = await response.json() as { error?: string; message?: string };
        if (json?.error || json?.message) {
          message = json.error || json.message || message;
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      // No content
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async listProjects(): Promise<CloudProject[]> {
    const data = await this._request<{ projects: CloudProject[] }>('/api/projects', {
      method: 'GET',
      expectedStatus: [200, 204],
    });

    return data?.projects ?? [];
  }

  async createProject(name: string): Promise<CloudProject> {
    const data = await this._request<{ project: CloudProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
      expectedStatus: [200, 201],
    });

    return data.project;
  }

  async saveProjectSnapshot(params: SaveSnapshotParams): Promise<CloudProjectVersion> {
    const { projectId, files, checksum, summary } = params;

    // We deliberately avoid zipping on the server: the client already has the
    // full FileMap, and JSZip is available in the browser. The server route
    // accepts a JSON representation and performs the archive + upload.
    const data = await this._request<{ version: CloudProjectVersion }>('/api/project-snapshots', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        files,
        checksum: checksum ?? null,
        summary: summary ?? null,
      }),
      expectedStatus: [200, 201],
    });

    return data.version;
  }

  async loadProjectSnapshot(projectId: string, versionNum: number): Promise<FileMap> {
    const data = await this._request<{ files: FileMap }>(
      `/api/project-snapshots?projectId=${encodeURIComponent(projectId)}&version=${encodeURIComponent(
        String(versionNum),
      )}`,
      {
        method: 'GET',
        expectedStatus: [200],
      },
    );

    return data.files;
  }

  async saveChat(params: {
    chatId: string;
    projectId: string | null;
    title: string | null;
    messages: {
      id: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: unknown;
      createdAt?: string;
    }[];
  }): Promise<void> {
    await this._request<void>('/api/chats', {
      method: 'POST',
      body: JSON.stringify(params),
      expectedStatus: [200, 201, 204],
    });
  }

  async loadChat(
    chatId: string,
  ): Promise<{
    chat: CloudChat | null;
    messages: CloudChatMessage[];
  }> {
    const data = await this._request<{
      chat: CloudChat | null;
      messages: CloudChatMessage[];
    }>(`/api/chats/${encodeURIComponent(chatId)}`, {
      method: 'GET',
      expectedStatus: [200, 404],
    });

    return {
      chat: data.chat,
      messages: data.messages ?? [],
    };
  }
}