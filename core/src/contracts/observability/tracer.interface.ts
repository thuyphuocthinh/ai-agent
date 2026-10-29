export type TSpanAttributeValue =
  | string
  | number
  | boolean
  | undefined
  | string[]
  | number[];

export type TSpanAttributes = Record<string, TSpanAttributeValue>;

export interface ISpanStatus {
  code: 'OK' | 'ERROR';
  message?: string;
}

/**
 * Interface đại diện cho một Span trong cây Trace phân tán.
 */
export interface ISpan {
  readonly traceId?: string;
  readonly spanId?: string;

  setAttribute(
    key: string,
    value: string | number | boolean | string[] | number[],
  ): this;
  setAttributes(attributes: TSpanAttributes): this;
  recordException(error: Error | string): this;
  setStatus(status: ISpanStatus): this;
  end(): void;
}

export interface ISpanOptions {
  attributes?: TSpanAttributes;
  root?: boolean;
}

/**
 * Port trừu tượng cho dịch vụ Tracing (OpenTelemetry hoặc No-Op).
 * Cho phép cắm rút adapter mà không phụ thuộc trực tiếp vào package cụ thể ở tầng logic.
 */
export interface ITracerService {
  startSpan(name: string, options?: ISpanOptions): ISpan;
  withSpan<T>(
    name: string,
    fn: (span: ISpan) => Promise<T>,
    options?: ISpanOptions,
  ): Promise<T>;
  getActiveSpan(): ISpan | undefined;
  getTraceContext(): { traceId?: string; spanId?: string };
}

export const TRACER_SERVICE = Symbol('TRACER_SERVICE');
