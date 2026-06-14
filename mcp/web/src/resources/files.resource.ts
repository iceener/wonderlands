/**
 * Files Resource Template
 *
 * Example of a dynamic resource using ResourceTemplate.
 * Exposes files from a virtual file system with:
 * - URI template: files:///{path}
 * - List callback for enumerating all files
 * - Complete callback for path autocompletion
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { HandlerExtra } from '../types/index.js';

/**
 * Virtual file system for demonstration.
 * In a real implementation, this would be backed by actual files or a database.
 */
const virtualFiles: Record<string, { content: string; mimeType: string }> = {
  'readme.md': {
    content: '# MCP Server Template\n\nThis is a demo file resource.',
    mimeType: 'text/markdown',
  },
  'config.json': {
    content: JSON.stringify({ version: '1.0.0', debug: false }, null, 2),
    mimeType: 'application/json',
  },
  'notes/todo.txt': {
    content: '- Implement feature A\n- Fix bug B\n- Write tests',
    mimeType: 'text/plain',
  },
  'notes/ideas.txt': {
    content: 'Some creative ideas for the project...',
    mimeType: 'text/plain',
  },
};

/**
 * List all available file paths.
 */
function listFilePaths(): string[] {
  return Object.keys(virtualFiles);
}

/**
 * Get file content by path.
 */
function getFile(path: string): { content: string; mimeType: string } | undefined {
  return virtualFiles[path];
}

/**
 * Find files matching a prefix (for autocompletion).
 */
function findFilesStartingWith(prefix: string): string[] {
  return listFilePaths().filter((path) => path.startsWith(prefix));
}

/**
 * Resource template for files:///{path}
 *
 * The template provides:
 * - list: Enumerate all available files
 * - complete.path: Autocomplete file paths
 */
export const filesTemplate = new ResourceTemplate('files:///{path}', {
  /**
   * List all available file instances.
   * Called when client requests resources/list.
   */
  list: async () => {
    const paths = listFilePaths();
    return {
      resources: paths.map((path) => ({
        uri: `files:///${path}`,
        name: path,
        mimeType: virtualFiles[path]?.mimeType ?? 'text/plain',
        description: `File: ${path}`,
      })),
    };
  },

  /**
   * Autocomplete for the {path} variable.
   * Called when client requests completion/complete.
   */
  complete: {
    path: async (value: string) => {
      return findFilesStartingWith(value);
    },
  },
});

/**
 * Handler for reading file content.
 *
 * @param uri - The full resource URI (e.g., files:///readme.md)
 * @param variables - Extracted template variables (e.g., { path: 'readme.md' })
 * @param extra - SDK context
 */
export async function filesHandler(
  uri: URL,
  variables: Record<string, string | string[]>,
  _extra: HandlerExtra,
): Promise<ReadResourceResult> {
  const pathValue = variables['path'];
  // Path can be string or string[] depending on the template; we expect a single string
  const path = Array.isArray(pathValue) ? pathValue[0] : pathValue;

  if (!path) {
    throw new Error('Path is required');
  }

  const file = getFile(path);
  if (!file) {
    throw new Error(`File not found: ${path}`);
  }

  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: file.mimeType,
        text: file.content,
      },
    ],
  };
}

/**
 * Metadata for the files resource.
 *
 * Note: Annotations (audience, priority) are defined here for documentation
 * but may not be supported by all SDK versions. When supported, they help
 * clients understand the resource's intended use.
 */
export const filesResourceMetadata = {
  name: 'files',
  description: 'Access files from the virtual file system by path.',
  mimeType: 'text/plain',
};
