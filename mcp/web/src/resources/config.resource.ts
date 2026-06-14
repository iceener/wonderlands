import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.js';
import { resourcesMetadata } from '../config/metadata.js';
import type { HandlerExtra } from '../types/index.js';

/**
 * Server Configuration Resource
 *
 * Exposes the current server configuration as a JSON resource.
 */
export const configResource = {
  name: resourcesMetadata.serverConfig.name,
  uri: resourcesMetadata.serverConfig.uri,
  description: resourcesMetadata.serverConfig.description,
  mimeType: resourcesMetadata.serverConfig.mimeType,

  handler: async (_uri: URL, _extra: HandlerExtra): Promise<ReadResourceResult> => {
    const configData = {
      name: config.NAME,
      version: config.VERSION,
      instructions: config.INSTRUCTIONS,
      logLevel: config.LOG_LEVEL,
      hasApiKey: !!config.FIRECRAWL_API_KEY,
      apiUrl: config.FIRECRAWL_API_URL,
      outputMode: config.OUTPUT_MODE,
      outputDir: config.OUTPUT_DIR,
    };

    return {
      contents: [
        {
          uri: resourcesMetadata.serverConfig.uri,
          mimeType: 'application/json',
          text: JSON.stringify(configData, null, 2),
        },
      ],
    };
  },
};

/**
 * Environment Information Resource
 *
 * Exposes runtime environment details.
 */
export const envResource = {
  name: resourcesMetadata.environment.name,
  uri: resourcesMetadata.environment.uri,
  description: resourcesMetadata.environment.description,
  mimeType: resourcesMetadata.environment.mimeType,

  handler: async (_uri: URL, _extra: HandlerExtra): Promise<ReadResourceResult> => {
    const envData = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cwd: process.cwd(),
    };

    return {
      contents: [
        {
          uri: resourcesMetadata.environment.uri,
          mimeType: 'application/json',
          text: JSON.stringify(envData, null, 2),
        },
      ],
    };
  },
};
