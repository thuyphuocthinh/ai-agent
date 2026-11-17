import { ExecutionContext, CallHandler, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TransformResponseInterceptor } from './transform-response.interceptor';
import { BYPASS_TRANSFORM_KEY } from '../decorators/bypass-transform.decorator';

describe('TransformResponseInterceptor', () => {
  let interceptor: TransformResponseInterceptor<unknown>;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TransformResponseInterceptor(reflector);
  });

  const createMockContext = (options?: {
    isBypass?: boolean;
    contentType?: string;
    statusCode?: number;
    traceId?: string;
  }): ExecutionContext => {
    const mockRes = {
      statusCode: options?.statusCode ?? 200,
      getHeader: jest.fn().mockImplementation((header: string) => {
        if (header.toLowerCase() === 'content-type') return options?.contentType;
        return undefined;
      }),
    };
    const mockReq = {
      headers: {
        'x-trace-id': options?.traceId,
      },
    };

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options?.isBypass ?? false);

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockRes,
        getRequest: () => mockReq,
      }),
    } as unknown as ExecutionContext;
  };

  it('wraps raw data in standard ApiResponseDto envelope', async () => {
    const context = createMockContext({ traceId: 'custom-trace-id' });
    const next: CallHandler = {
      handle: () => of({ name: 'Agent Smith' }),
    };

    const observable = interceptor.intercept(context, next);
    const result = await new Promise<any>((resolve) => observable.subscribe(resolve));

    expect(result).toMatchObject({
      statusCode: 200,
      message: 'Success',
      data: { name: 'Agent Smith' },
      traceId: 'custom-trace-id',
    });
    expect(result.timestamp).toBeDefined();
  });

  it('preserves paginated data and meta in envelope', async () => {
    const context = createMockContext();
    const paginatedPayload = {
      data: [{ id: 1 }, { id: 2 }],
      meta: { page: 1, limit: 10, total: 2 },
    };
    const next: CallHandler = {
      handle: () => of(paginatedPayload),
    };

    const observable = interceptor.intercept(context, next);
    const result = await new Promise<any>((resolve) => observable.subscribe(resolve));

    expect(result).toMatchObject({
      statusCode: 200,
      message: 'Success',
      data: [{ id: 1 }, { id: 2 }],
      meta: { page: 1, limit: 10, total: 2 },
    });
  });

  it('bypasses transformation when @BypassTransform metadata is set', async () => {
    const context = createMockContext({ isBypass: true });
    const rawData = 'data: raw sse message\n\n';
    const next: CallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(context, next);
    const result = await new Promise<any>((resolve) => observable.subscribe(resolve));

    expect(result).toBe(rawData);
  });

  it('bypasses transformation when content-type is text/event-stream', async () => {
    const context = createMockContext({ contentType: 'text/event-stream' });
    const rawData = 'data: ping\n\n';
    const next: CallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(context, next);
    const result = await new Promise<any>((resolve) => observable.subscribe(resolve));

    expect(result).toBe(rawData);
  });

  it('bypasses transformation and returns raw StreamableFile instance', async () => {
    const context = createMockContext({ isBypass: false });
    const file = new StreamableFile(Buffer.from('binary-content'));
    const next: CallHandler = {
      handle: () => of(file),
    };

    const observable = interceptor.intercept(context, next);
    const result = await new Promise<any>((resolve) => observable.subscribe(resolve));

    expect(result).toBe(file);
    expect(result instanceof StreamableFile).toBe(true);
  });
});
