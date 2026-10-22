import { SetMetadata } from '@nestjs/common';

export const BYPASS_TRANSFORM_KEY = '__bypass_transform__';

/**
 * Đánh dấu route không bọc dữ liệu qua TransformResponseInterceptor.
 * Dùng cho các route SSE streaming, raw binary buffer, webhook callbacks hoặc file download.
 */
export const BypassTransform = () => SetMetadata(BYPASS_TRANSFORM_KEY, true);
