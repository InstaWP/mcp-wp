// src/tools/media.ts
import axios from 'axios';
import FormData from 'form-data';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { userAgentHeader } from '../config/user-agent.js';
import { WPMedia } from '../types/wordpress-types.js';
import { z } from 'zod';

const mediaContextSchema = z.enum(['view', 'embed', 'edit']);
const mediaTypeSchema = z.enum(['image', 'video', 'text', 'application', 'audio']);
const mediaOrderSchema = z.enum(['asc', 'desc']);
const mediaOrderBySchema = z.enum([
  'author',
  'date',
  'id',
  'include',
  'modified',
  'parent',
  'relevance',
  'slug',
  'include_slugs',
  'title'
]);

const listMediaSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  page: z.coerce.number().optional().describe("Page number (default 1)"),
  per_page: z.coerce.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for media"),
  context: mediaContextSchema.optional().describe("Scope under which the request is made"),
  media_type: mediaTypeSchema.optional().describe("Limit results to a specific media type"),
  mime_type: z.string().optional().describe("Limit results to a specific MIME type"),
  parent: z.union([z.coerce.number(), z.array(z.coerce.number())]).optional().describe("Parent content ID or array of parent IDs"),
  orderby: mediaOrderBySchema.optional().describe("Sort media by parameter"),
  order: mediaOrderSchema.optional().describe("Order sort attribute ascending or descending"),
  after: z.string().optional().describe("ISO8601 date string to get media published after this date"),
  before: z.string().optional().describe("ISO8601 date string to get media published before this date")
}).strict();

const getMediaSchema = z.object({
  id: z.coerce.number().describe("Media ID"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  context: mediaContextSchema.optional().describe("Scope under which the request is made")
}).strict();

const createMediaSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().optional().describe("Media title. If omitted, derived from the uploaded filename."),
  alt_text: z.string().optional().describe("Alternate text for the media"),
  caption: z.string().optional().describe("Caption of the media"),
  description: z.string().optional().describe("Description of the media"),
  post: z.coerce.number().optional().describe("Associated post ID"),
  source_url: z.string().optional().describe("Remote HTTP(S) URL of the media file"),
  file_path: z.string().optional().describe("Local file path to upload. Relative paths are resolved from the server working directory.")
}).strict();

const updateMediaSchema = z.object({
  id: z.coerce.number().describe("Media ID to update"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  title: z.string().optional().describe("Media title"),
  alt_text: z.string().optional().describe("Alternate text for the media"),
  caption: z.string().optional().describe("Caption of the media"),
  description: z.string().optional().describe("Description of the media"),
  post: z.coerce.number().optional().describe("Associated post ID")
}).strict();

const deleteMediaSchema = z.object({
  id: z.coerce.number().describe("Media ID to delete"),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  force: z.boolean().optional().describe("Force deletion bypassing trash")
}).strict();

type ListMediaParams = z.infer<typeof listMediaSchema>;
type GetMediaParams = z.infer<typeof getMediaSchema>;
type CreateMediaParams = z.infer<typeof createMediaSchema>;
type UpdateMediaParams = z.infer<typeof updateMediaSchema>;
type DeleteMediaParams = z.infer<typeof deleteMediaSchema>;

type UploadSource = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  derivedTitle: string;
};

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.zip': 'application/zip'
};

const DEFAULT_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
};

function successResult(payload: unknown) {
  return {
    toolResult: {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
    }
  };
}

function errorResult(action: string, error: unknown) {
  const errorMessage = error instanceof Error
    ? error.message
    : ((error as any)?.response?.data?.message || (error as any)?.message || String(error));

  return {
    toolResult: {
      isError: true,
      content: [{ type: 'text', text: `Error ${action}: ${errorMessage}` }]
    }
  };
}

function sanitizeFilenamePart(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'upload';
}

function humanizeTitle(filename: string) {
  const basename = path.parse(filename).name;
  const normalized = basename.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Upload';
}

function inferMimeType(filename: string) {
  return MIME_TYPE_BY_EXTENSION[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function defaultExtensionForMimeType(mimeType: string) {
  return DEFAULT_EXTENSION_BY_MIME_TYPE[mimeType] || '';
}

function ensureFilenameHasExtension(filename: string, mimeType: string) {
  if (path.extname(filename)) {
    return filename;
  }

  const extension = defaultExtensionForMimeType(mimeType);
  return extension ? `${filename}${extension}` : filename;
}

function buildUploadFilename(originalFilename: string, explicitTitle?: string) {
  if (!explicitTitle?.trim()) {
    return originalFilename;
  }

  const extension = path.extname(originalFilename);
  const sanitizedTitle = sanitizeFilenamePart(explicitTitle);
  return extension ? `${sanitizedTitle}${extension}` : sanitizedTitle;
}

function normalizeMimeType(contentTypeHeader?: string) {
  if (!contentTypeHeader) {
    return 'application/octet-stream';
  }

  return contentTypeHeader.split(';')[0].trim() || 'application/octet-stream';
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function deriveFilenameFromUrl(sourceUrl: string, mimeType: string) {
  try {
    const url = new URL(sourceUrl);
    const pathname = decodeURIComponent(url.pathname);
    const basename = path.basename(pathname);

    if (basename && basename !== '.' && basename !== '/') {
      return ensureFilenameHasExtension(basename, mimeType);
    }
  } catch {
    // Invalid URLs are handled earlier; this only protects filename parsing.
  }

  return `upload${defaultExtensionForMimeType(mimeType)}`;
}

async function loadUploadFromFilePath(filePath: string, explicitTitle?: string): Promise<UploadSource> {
  const resolvedPath = path.resolve(process.cwd(), filePath);

  let fileStats;
  try {
    fileStats = await fs.stat(resolvedPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw new Error(`Unable to access file_path '${filePath}': ${error.message}`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  const originalFilename = path.basename(resolvedPath);
  const filename = buildUploadFilename(originalFilename, explicitTitle);
  const mimeType = inferMimeType(originalFilename);
  const buffer = await fs.readFile(resolvedPath);

  return {
    buffer,
    filename,
    mimeType,
    derivedTitle: explicitTitle?.trim() || humanizeTitle(filename)
  };
}

async function loadUploadFromUrl(sourceUrl: string, explicitTitle?: string): Promise<UploadSource> {
  if (!isHttpUrl(sourceUrl)) {
    throw new Error('source_url must be an absolute http or https URL');
  }

  const response = await axios.get<ArrayBuffer>(sourceUrl, {
    responseType: 'arraybuffer',
    headers: userAgentHeader()
  });
  const contentTypeHeader = response.headers['content-type'];
  const mimeType = normalizeMimeType(typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined);
  const originalFilename = deriveFilenameFromUrl(sourceUrl, mimeType);
  const filename = buildUploadFilename(originalFilename, explicitTitle);

  return {
    buffer: Buffer.from(response.data),
    filename,
    mimeType,
    derivedTitle: explicitTitle?.trim() || humanizeTitle(filename)
  };
}

async function loadUploadSource(params: CreateMediaParams) {
  const sourceCount = Number(Boolean(params.source_url)) + Number(Boolean(params.file_path));

  if (sourceCount !== 1) {
    throw new Error('Provide exactly one of source_url or file_path when creating media.');
  }

  if (params.file_path) {
    return loadUploadFromFilePath(params.file_path, params.title);
  }

  return loadUploadFromUrl(params.source_url!, params.title);
}

function appendOptionalFormField(form: FormData, key: string, value: string | number | undefined) {
  if (value === undefined) {
    return;
  }

  form.append(key, String(value));
}

async function uploadMedia(params: CreateMediaParams): Promise<WPMedia> {
  const uploadSource = await loadUploadSource(params);
  const form = new FormData();
  const title = params.title?.trim() || uploadSource.derivedTitle;

  form.append('file', uploadSource.buffer, {
    filename: uploadSource.filename,
    contentType: uploadSource.mimeType
  });

  appendOptionalFormField(form, 'title', title);
  appendOptionalFormField(form, 'alt_text', params.alt_text);
  appendOptionalFormField(form, 'caption', params.caption);
  appendOptionalFormField(form, 'description', params.description);
  appendOptionalFormField(form, 'post', params.post);

  const response = await makeWordPressRequest('POST', 'media', form, {
    isFormData: true,
    headers: form.getHeaders(),
    siteId: params.site_id
  });

  return response as WPMedia;
}

function buildMediaUpdateData(params: UpdateMediaParams) {
  const updateData: Record<string, string | number> = {};

  if (params.title !== undefined) updateData.title = params.title;
  if (params.alt_text !== undefined) updateData.alt_text = params.alt_text;
  if (params.caption !== undefined) updateData.caption = params.caption;
  if (params.description !== undefined) updateData.description = params.description;
  if (params.post !== undefined) updateData.post = params.post;

  if (Object.keys(updateData).length === 0) {
    throw new Error('Provide at least one field to update.');
  }

  return updateData;
}

const updateMediaHandler = async (params: UpdateMediaParams) => {
  try {
    const { id, site_id } = params;
    const response = await makeWordPressRequest(
      'POST',
      `media/${id}`,
      buildMediaUpdateData(params),
      { siteId: site_id }
    );

    const media: WPMedia = response;
    return successResult(media);
  } catch (error: any) {
    return errorResult('updating media', error);
  }
};

export const mediaTools: Tool[] = [
  {
    name: 'list_media',
    description: 'Lists media items with filtering and pagination options',
    inputSchema: { type: 'object', properties: listMediaSchema.shape }
  },
  {
    name: 'get_media',
    description: 'Gets a media item by ID',
    inputSchema: { type: 'object', properties: getMediaSchema.shape }
  },
  {
    name: 'create_media',
    description: 'Creates a new media item from a URL or local file path',
    inputSchema: { type: 'object', properties: createMediaSchema.shape }
  },
  {
    name: 'update_media',
    description: 'Updates an existing media item',
    inputSchema: { type: 'object', properties: updateMediaSchema.shape }
  },
  {
    name: 'edit_media',
    description: 'Legacy alias for update_media',
    inputSchema: { type: 'object', properties: updateMediaSchema.shape }
  },
  {
    name: 'delete_media',
    description: 'Deletes a media item',
    inputSchema: { type: 'object', properties: deleteMediaSchema.shape }
  }
];

export const mediaHandlers = {
  list_media: async (params: ListMediaParams) => {
    try {
      const { site_id, ...queryParams } = params;
      const response = await makeWordPressRequest('GET', 'media', queryParams, { siteId: site_id });
      const media: WPMedia[] = response;
      return successResult(media);
    } catch (error: any) {
      return errorResult('listing media', error);
    }
  },

  get_media: async (params: GetMediaParams) => {
    try {
      const response = await makeWordPressRequest(
        'GET',
        `media/${params.id}`,
        params.context ? { context: params.context } : undefined,
        { siteId: params.site_id }
      );

      const media: WPMedia = response;
      return successResult(media);
    } catch (error: any) {
      return errorResult('getting media', error);
    }
  },

  create_media: async (params: CreateMediaParams) => {
    try {
      const media = await uploadMedia(params);
      return successResult(media);
    } catch (error: any) {
      return errorResult('creating media', error);
    }
  },

  update_media: updateMediaHandler,
  edit_media: updateMediaHandler,

  delete_media: async (params: DeleteMediaParams) => {
    try {
      const { id, force, site_id } = params;
      const response = await makeWordPressRequest('DELETE', `media/${id}`, { force }, { siteId: site_id });
      return successResult(response);
    } catch (error: any) {
      return errorResult('deleting media', error);
    }
  }
};
