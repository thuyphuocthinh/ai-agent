/**
 * Bọc một Promise với thời gian timeout (ms).
 * Nếu hết thời gian mà Promise chưa giải quyết, tự động reject với `message`
 * và kích hoạt `controller.abort()` nếu có truyền `controller`.
 * Tuân thủ strict type safety (zero any).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(message));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
