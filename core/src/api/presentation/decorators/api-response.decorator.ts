import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiResponseDto } from '../dtos/api-response.dto';
import { NumberedPageMetaDto, CursorPageMetaDto } from '../dtos/pagination.dto';

export const ApiDataResponse = (
  model: Type<unknown>,
  status = 200,
  description = 'Thành công',
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );

export const ApiNumberedPageResponse = (
  model: Type<unknown>,
  description = 'Danh sách phân trang theo trang',
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, NumberedPageMetaDto, model),
    ApiResponse({
      status: 200,
      description,
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'number', example: 200 },
          message: { type: 'string', example: 'Success' },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(NumberedPageMetaDto) },
          timestamp: { type: 'string', example: '2026-10-22T21:15:00.000Z' },
          traceId: { type: 'string', example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' },
        },
      },
    }),
  );

export const ApiCursorPageResponse = (
  model: Type<unknown>,
  description = 'Danh sách phân trang theo con trỏ',
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, CursorPageMetaDto, model),
    ApiResponse({
      status: 200,
      description,
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'number', example: 200 },
          message: { type: 'string', example: 'Success' },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(CursorPageMetaDto) },
          timestamp: { type: 'string', example: '2026-10-22T21:15:00.000Z' },
          traceId: { type: 'string', example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' },
        },
      },
    }),
  );
