import {
  CursorPaginationQueryDto,
  CursorPageMetaDto,
  NumberedPaginationQueryDto,
  NumberedPageMetaDto,
  PaginatedResult,
} from '../../../api/presentation/dtos/pagination.dto';

export type SortOrder = 'asc' | 'desc';

export type OrderByFieldMap = Record<string, SortOrder>;

export type OrderByClause = OrderByFieldMap | OrderByFieldMap[];

export interface CursorPaginateOptions<
  TWhere = Record<string, unknown>,
  TSelect = Record<string, unknown>,
> {
  where?: TWhere;
  select?: TSelect;
  /**
   * Hỗ trợ sắp xếp theo 1 hoặc nhiều trường (Multi-field ordering).
   * Ví dụ:
   * - Single: { lastSeenAt: 'desc' }
   * - Multi: [{ lastSeenAt: 'desc' }, { id: 'desc' }]
   */
  orderBy?: OrderByClause;
  /** Trường sắp xếp đơn (tương thích ngược) */
  orderByField?: string;
  /** Hướng sắp xếp đơn ('asc' | 'desc') */
  sortOrder?: SortOrder;
}

export interface OffsetPaginateOptions<
  TWhere = Record<string, unknown>,
  TSelect = Record<string, unknown>,
> {
  where?: TWhere;
  select?: TSelect;
  /**
   * Hỗ trợ sắp xếp theo 1 hoặc nhiều trường (Multi-field ordering).
   */
  orderBy?: OrderByClause;
  orderByField?: string;
  sortOrder?: SortOrder;
}

export interface PrismaModelWithPagination<
  TRecord extends { id: string },
  TWhere = Record<string, unknown>,
  TSelect = Record<string, unknown>,
> {
  findMany(args: {
    where?: TWhere;
    select?: TSelect;
    take?: number;
    skip?: number;
    cursor?: { id: string };
    orderBy?: OrderByClause;
  }): Promise<TRecord[]>;
  count?(args?: { where?: TWhere }): Promise<number>;
}

/**
 * Chuẩn hóa mệnh đề OrderBy để hỗ trợ linh hoạt cả 1 field lẫn multi-field ordering.
 * Với Cursor-based, luôn đảm bảo trường unique `id` được thêm vào cuối làm tie-breaker
 * nếu người dùng sắp xếp theo trường có thể trùng lặp (ví dụ `createdAt`, `lastSeenAt`, `status`).
 */
function resolveOrderBy(
  options: {
    orderBy?: OrderByClause;
    orderByField?: string;
    sortOrder?: SortOrder;
  },
  ensureCursorTieBreaker = false,
): OrderByClause {
  const defaultSortOrder = options.sortOrder ?? 'desc';

  let list: OrderByFieldMap[] = [];

  if (options.orderBy) {
    if (Array.isArray(options.orderBy)) {
      list = [...options.orderBy];
    } else {
      list = [options.orderBy];
    }
  } else if (options.orderByField) {
    list = [{ [options.orderByField]: defaultSortOrder }];
  } else {
    list = [{ id: defaultSortOrder }];
  }

  // Với Cursor pagination: Cần đảm bảo có tie-breaker duy nhất (id) ở cuối
  if (ensureCursorTieBreaker) {
    const hasId = list.some((item) => Object.prototype.hasOwnProperty.call(item, 'id'));
    if (!hasId) {
      list.push({ id: defaultSortOrder });
    }
  }

  return list.length === 1 ? list[0] : list;
}

/**
 * Phân trang dựa trên con trỏ (Cursor-based) tối ưu cho Time-sortable UUIDv7 B-Tree index.
 * Hỗ trợ đa trường sắp xếp (Multi-field ordering) kèm tie-breaker tự động.
 */
export async function paginateCursor<
  TRecord extends { id: string },
  TWhere = Record<string, unknown>,
  TSelect = Record<string, unknown>,
>(
  model: PrismaModelWithPagination<TRecord, TWhere, TSelect>,
  query: CursorPaginationQueryDto,
  options: CursorPaginateOptions<TWhere, TSelect> = {},
): Promise<PaginatedResult<TRecord, CursorPageMetaDto>> {
  const limit = query.limit ?? 50;
  const cursor = query.cursor;
  const orderBy = resolveOrderBy(options, true);

  const findArgs: Parameters<typeof model.findMany>[0] = {
    where: options.where,
    take: limit + 1,
    orderBy,
  };

  if (options.select) {
    findArgs.select = options.select;
  }

  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1; // Bỏ qua chính bản ghi cursor
  }

  const items = await model.findMany(findArgs);
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : undefined;

  return {
    data,
    meta: new CursorPageMetaDto(limit, nextCursor, hasMore),
  };
}

/**
 * Phân trang truyền thống (Offset-based) cho các màn hình Admin Dashboard có số trang.
 * Hỗ trợ đa trường sắp xếp (Multi-field ordering).
 */
export async function paginateNumbered<
  TRecord extends { id: string },
  TWhere = Record<string, unknown>,
  TSelect = Record<string, unknown>,
>(
  model: PrismaModelWithPagination<TRecord, TWhere, TSelect>,
  query: NumberedPaginationQueryDto,
  options: OffsetPaginateOptions<TWhere, TSelect> = {},
): Promise<PaginatedResult<TRecord, NumberedPageMetaDto>> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;
  const orderBy = resolveOrderBy(options, false);

  const [total, data] = await Promise.all([
    model.count ? model.count({ where: options.where }) : Promise.resolve(0),
    model.findMany({
      where: options.where,
      select: options.select,
      skip,
      take: limit,
      orderBy,
    }),
  ]);

  return {
    data,
    meta: new NumberedPageMetaDto(page, limit, total),
  };
}
