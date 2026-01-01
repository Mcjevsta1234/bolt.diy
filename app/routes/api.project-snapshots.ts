import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';
import type { FileMap } from '~/lib/stores/files';

const logger = createScopedLogger('api.project-snapshots');

function getSupabaseEnv(context: any) {
  const env = context?.cloudflare?.env as Env | undefined;

  if (!env?.SAAS_SUPABASE_URL || !env?.SAAS_SUPABASE_SERVICE_ROLE_KEY || !env?.SAAS_SUPABASE_STORAGE_BUCKET) {
    return null;
  }

  return {
    url: env.SAAS_SUPABASE_URL,
    serviceKey: env.SAAS_SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.SAAS_SUPABASE_STORAGE_BUCKET,
  };
}

async function getNextVersionNum(supabase: { url: string; serviceKey: string }, projectId: string): Promise<number> {
  const url = new URL('/rest/v1/project_versions', supabase.url);
  url.searchParams.set('select', 'version_num');
  url.searchParams.set('project_id', `eq.${projectId}`);
  url.searchParams.set('order', 'version_num.desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      apikey: supabase.serviceKey,
      Authorization: `Bearer ${supabase.serviceKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Failed to fetch latest project version', { status: response.status, text });
    throw new Error('Failed to fetch latest project version');
  }

  const rows = (await response.json()) as { version_num: number }[];

  if (!rows.length) {
    return 1;
  }

  const latest = rows[0]?.version_num ?? 0;
  return latest + 1;
}

async function archiveFilesToZipBlob(files: FileMap): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const [filePath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    // FileMap keys are absolute paths rooted at the WebContainer workdir;
    // project-level relative paths should be derived on the client before
    // calling this endpoint. For now we simply use the key as-is.
    zip.file(filePath, dirent.content);
  }

  return zip.generateAsync({ type: 'blob' });
}

async function uploadSnapshotToStorage(
  supabase: { url: string; serviceKey: string; bucket: string },
  {
    ownerId,
    projectId,
    versionId,
    blob,
  }: {
    ownerId: string | null;
    projectId: string;
    versionId: string;
    blob: Blob;
  },
): Promise<string> {
  const ownerPrefix = ownerId ?? 'anonymous';
  const objectPath = `${ownerPrefix}/${projectId}/${versionId}.zip`;

  const url = new URL(`/storage/v1/object/${encodeURIComponent(supabase.bucket)}/${objectPath}`, supabase.url);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      apikey: supabase.serviceKey,
      Authorization: `Bearer ${supabase.serviceKey}`,
    },
    body: blob,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Failed to upload snapshot to Supabase Storage', { status: response.status, text });
    throw new Error('Failed to upload snapshot to storage');
  }

  return objectPath;
}

async function createProjectVersionRow(
  supabase: { url: string; serviceKey: string },
  params: { projectId: string; versionNum: number; storagePath: string; checksum: string | null },
) {
  const url = new URL('/rest/v1/project_versions', supabase.url);
  url.searchParams.set('select', 'id,project_id,version_num,storage_path,checksum,created_at');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      apikey: supabase.serviceKey,
      Authorization: `Bearer ${supabase.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      project_id: params.projectId,
      version_num: params.versionNum,
      storage_path: params.storagePath,
      checksum: params.checksum,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Failed to create project_versions row', { status: response.status, text });
    throw new Error('Failed to create project version');
  }

  const [row] = (await response.json()) as {
    id: string;
    project_id: string;
    version_num: number;
    storage_path: string;
    checksum: string | null;
    created_at: string;
  }[];

  return row;
}

async function saveSnapshotAction({ request, context }: ActionFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    return json({ error: 'Remote persistence is not configured' }, { status: 501 });
  }

  try {
    const body = await request.json().catch(() => ({})) as Record<string, any>;

    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const files = (body.files ?? {}) as FileMap;
    const checksum = typeof body.checksum === 'string' ? body.checksum : null;

    if (!projectId) {
      return json({ error: 'projectId is required' }, { status: 400 });
    }

    // Owner identification is intentionally loose here: the SaaS layer should
    // eventually resolve this based on user auth and pass it through.
    const ownerId =
      typeof body.ownerId === 'string' && body.ownerId.trim().length > 0 ? body.ownerId.trim() : null;

    const nextVersionNum = await getNextVersionNum(supabase, projectId);

    const zipBlob = await archiveFilesToZipBlob(files);
    const storagePath = await uploadSnapshotToStorage(supabase, {
      ownerId,
      projectId,
      versionId: String(nextVersionNum),
      blob: zipBlob,
    });

    const versionRow = await createProjectVersionRow(supabase, {
      projectId,
      versionNum: nextVersionNum,
      storagePath,
      checksum,
    });

    const version = {
      id: versionRow.id,
      projectId: versionRow.project_id,
      versionNum: versionRow.version_num,
      storagePath: versionRow.storage_path,
      checksum: versionRow.checksum,
      createdAt: versionRow.created_at,
    };

    return json({ version }, { status: 201 });
  } catch (error) {
    logger.error('Unexpected error saving project snapshot', error);
    return json({ error: 'Unexpected error saving project snapshot' }, { status: 500 });
  }
}

async function loadSnapshotLoader({ request, context }: LoaderFunctionArgs) {
  const supabase = getSupabaseEnv(context);

  if (!supabase) {
    return json({ error: 'Remote persistence is not configured' }, { status: 501 });
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const versionParam = url.searchParams.get('version');

  if (!projectId || !versionParam) {
    return json({ error: 'projectId and version are required' }, { status: 400 });
  }

  const versionNum = Number(versionParam);

  if (!Number.isFinite(versionNum) || versionNum <= 0) {
    return json({ error: 'version must be a positive integer' }, { status: 400 });
  }

  try {
    // Look up the project_versions row to get storage_path
    const versionUrl = new URL('/rest/v1/project_versions', supabase.url);
    versionUrl.searchParams.set('select', 'id,project_id,version_num,storage_path');
    versionUrl.searchParams.set('project_id', `eq.${projectId}`);
    versionUrl.searchParams.set('version_num', `eq.${versionNum}`);

    const versionResponse = await fetch(versionUrl.toString(), {
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!versionResponse.ok) {
      const text = await versionResponse.text();
      logger.error('Failed to fetch project version from Supabase', {
        status: versionResponse.status,
        text,
      });
      return json({ error: 'Failed to load project snapshot version' }, { status: 500 });
    }

    const versionRows = (await versionResponse.json()) as {
      id: string;
      project_id: string;
      version_num: number;
      storage_path: string;
    }[];

    if (!versionRows.length) {
      return json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const row = versionRows[0];

    // Download the zip from Storage
    const storageUrl = new URL(
      `/storage/v1/object/${encodeURIComponent(supabase.bucket)}/${row.storage_path}`,
      supabase.url,
    );

    const storageResponse = await fetch(storageUrl.toString(), {
      headers: {
        apikey: supabase.serviceKey,
        Authorization: `Bearer ${supabase.serviceKey}`,
      },
    });

    if (!storageResponse.ok) {
      const text = await storageResponse.text();
      logger.error('Failed to download snapshot from Supabase Storage', {
        status: storageResponse.status,
        text,
      });
      return json({ error: 'Failed to download project snapshot' }, { status: 500 });
    }

    const arrayBuffer = await storageResponse.arrayBuffer();
    const uint = new Uint8Array(arrayBuffer);

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(uint);

    const files: FileMap = {};

    const entries = Object.values(zip.files);

    for (const entry of entries) {
      if (entry.dir) {
        continue;
      }

      const content = await entry.async('string');

      files[entry.name] = {
        type: 'file',
        content,
        isBinary: false,
      };
    }

    return json({ files }, { status: 200 });
  } catch (error) {
    logger.error('Unexpected error loading project snapshot', error);
    return json({ error: 'Unexpected error loading project snapshot' }, { status: 500 });
  }
}

export const loader = withSecurity(loadSnapshotLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

export const action = withSecurity(saveSnapshotAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});