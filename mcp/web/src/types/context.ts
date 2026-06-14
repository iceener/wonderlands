/**
 * Request context types for MCP handlers.
 *
 * This module re-exports the SDK's RequestHandlerExtra type and provides
 * additional utilities for context management.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

/**
 * Progress token from client request.
 * Used to correlate progress notifications with the originating request.
 */
export type ProgressToken = string | number;

/**
 * Progress notification parameters.
 */
export interface ProgressParams {
  /** Must match the original request's progressToken */
  progressToken: ProgressToken;
  /** Current progress value (must increase monotonically) */
  progress: number;
  /** Total expected value (enables percentage calculation) */
  total?: number;
  /** Human-readable status message */
  message?: string;
}

/**
 * Re-export SDK's RequestHandlerExtra for convenience.
 *
 * This is what handlers actually receive from the SDK.
 * Key properties:
 * - signal: AbortSignal for cancellation
 * - _meta?.progressToken: Token for progress notifications
 * - sendNotification: Send notifications to client
 * - sessionId: Current session ID
 */
export type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

/**
 * Simplified handler extra type for documentation purposes.
 * Use RequestHandlerExtra from the SDK in actual implementations.
 */
export interface HandlerExtraInfo {
  /** AbortSignal triggered when client cancels */
  signal: AbortSignal;
  /** Metadata from request */
  _meta?: {
    progressToken?: ProgressToken;
  };
  /** Send notification to client */
  sendNotification: (notification: ServerNotification) => Promise<void>;
  /** Session ID */
  sessionId?: string;
}

/**
 * Cancellation token interface for manual cancellation tracking.
 */
export interface CancellationToken {
  readonly isCancelled: boolean;
  cancel(reason?: string): void;
  onCancel(callback: () => void): void;
}

/**
 * Create a new cancellation token.
 */
export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  const callbacks: Array<() => void> = [];

  return {
    get isCancelled() {
      return cancelled;
    },
    cancel(_reason?: string) {
      if (!cancelled) {
        cancelled = true;
        for (const cb of callbacks) {
          try {
            cb();
          } catch {
            // Ignore callback errors
          }
        }
      }
    },
    onCancel(callback: () => void) {
      if (cancelled) {
        callback();
      } else {
        callbacks.push(callback);
      }
    },
  };
}

/**
 * Request context stored per active request.
 */
export interface RequestContext {
  /** Unique request identifier */
  requestId: string;
  /** Cancellation token for this request */
  cancellationToken: CancellationToken;
  /** Timestamp when request started */
  timestamp: number;
  /** Optional auth headers */
  authHeaders?: { authorization?: string };
  /** Reference to the server for notifications */
  server?: McpServer;
}

/**
 * Registry for tracking active request contexts.
 * Useful for custom context management beyond what the SDK provides.
 */
class ContextRegistry {
  private readonly contexts = new Map<string, RequestContext>();

  create(requestId: string, server?: McpServer): RequestContext {
    const ctx: RequestContext = {
      requestId,
      cancellationToken: createCancellationToken(),
      timestamp: Date.now(),
      server,
    };
    this.contexts.set(requestId, ctx);
    return ctx;
  }

  get(requestId: string): RequestContext | undefined {
    return this.contexts.get(requestId);
  }

  delete(requestId: string): void {
    this.contexts.delete(requestId);
  }

  clear(): void {
    this.contexts.clear();
  }
}

/** Global context registry instance */
export const contextRegistry = new ContextRegistry();
