/**
 * Cursor-based pagination utilities.
 *
 * MCP uses cursor-based pagination with `cursor` parameter for requests
 * and `nextCursor` in responses. This is more robust than offset-based
 * pagination for dynamic data.
 *
 * @example
 * // In a tool handler
 * const items = await fetchAllItems();
 * const page = paginateArray(items, cursor, 50);
 *
 * return {
 *   content: [{ type: 'text', text: JSON.stringify(page.items) }],
 *   structuredContent: {
 *     items: page.items,
 *     nextCursor: page.nextCursor,
 *     hasMore: page.hasMore,
 *   },
 * };
 */

/**
 * Paginated result with cursor for next page.
 */
export interface PaginatedResult<T> {
  /** Items in current page */
  items: T[];
  /** Cursor for next page (undefined if no more pages) */
  nextCursor?: string;
  /** Whether there are more items after this page */
  hasMore: boolean;
  /** Total count if known */
  total?: number;
}

/**
 * Cursor data encoded in the cursor string.
 */
interface CursorData {
  /** Offset position */
  offset: number;
  /** Optional: ID of last item for keyset pagination */
  lastId?: string;
}

/**
 * Encode cursor data to a base64 string.
 */
export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

/**
 * Decode a cursor string to cursor data.
 * Returns undefined if cursor is invalid.
 */
export function decodeCursor(cursor: string): CursorData | undefined {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const data = JSON.parse(json);
    if (typeof data.offset === 'number') {
      return data as CursorData;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Paginate an array using cursor-based pagination.
 *
 * @param items - Full array of items
 * @param cursor - Cursor from previous page (undefined for first page)
 * @param pageSize - Number of items per page (default: 50)
 * @returns Paginated result with items and next cursor
 *
 * @example
 * const allUsers = await db.users.findAll();
 * const page = paginateArray(allUsers, request.cursor, 20);
 * // page.items = first 20 users
 * // page.nextCursor = cursor to get next 20
 * // page.hasMore = true if more users exist
 */
export function paginateArray<T>(items: T[], cursor?: string, pageSize = 50): PaginatedResult<T> {
  const offset = cursor ? (decodeCursor(cursor)?.offset ?? 0) : 0;
  const pageItems = items.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < items.length;

  return {
    items: pageItems,
    nextCursor: hasMore ? encodeCursor({ offset: offset + pageSize }) : undefined,
    hasMore,
    total: items.length,
  };
}

/**
 * Create a paginated result from a pre-sliced page of items.
 *
 * Use this when you've already fetched a page from a database
 * and need to construct the pagination metadata.
 *
 * @param items - Items in the current page
 * @param currentOffset - Current offset position
 * @param pageSize - Page size used
 * @param total - Total count of all items
 */
export function createPaginatedResult<T>(
  items: T[],
  currentOffset: number,
  pageSize: number,
  total: number,
): PaginatedResult<T> {
  const hasMore = currentOffset + items.length < total;

  return {
    items,
    nextCursor: hasMore ? encodeCursor({ offset: currentOffset + pageSize }) : undefined,
    hasMore,
    total,
  };
}

/**
 * Parse pagination parameters from tool arguments.
 *
 * @param args - Tool arguments that may contain cursor
 * @param defaultPageSize - Default page size if not specified
 * @returns Parsed offset and page size
 */
export function parsePaginationArgs(
  args: { cursor?: string; limit?: number },
  defaultPageSize = 50,
): { offset: number; pageSize: number } {
  const offset = args.cursor ? (decodeCursor(args.cursor)?.offset ?? 0) : 0;
  const pageSize = Math.min(Math.max(args.limit ?? defaultPageSize, 1), 100);

  return { offset, pageSize };
}
