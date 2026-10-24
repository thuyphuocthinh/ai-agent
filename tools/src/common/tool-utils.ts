export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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
      (error: any) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const PII_REGEX = {
  CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  SSN: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  PHONE: /(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g,
  JWT: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  PRIVATE_KEY: /-----BEGIN .*?PRIVATE KEY-----[\s\S]*?-----END .*?PRIVATE KEY-----/g,
};

export class PiiScrubberUtil {
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'cvv',
    'credit_card',
    'ssn',
    'authorization',
    'auth',
    'cookie',
    'session',
    'private_key',
  ]);

  static scrub(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.scrubString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.scrub(item));
    }

    if (typeof data === 'object') {
      const scrubbedObj: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (this.isSensitiveKey(key)) {
          scrubbedObj[key] = '[REDACTED_BY_SECURITY_GATE]';
        } else {
          scrubbedObj[key] = this.scrub(value);
        }
      }
      return scrubbedObj;
    }

    return data;
  }

  private static isSensitiveKey(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const sensitiveKey of this.SENSITIVE_KEYS) {
      if (normalizedKey.includes(sensitiveKey.replace(/[^a-z0-9]/g, ''))) {
        return true;
      }
    }
    return false;
  }

  private static scrubString(text: string): string {
    let scrubbed = text;
    scrubbed = scrubbed.replace(PII_REGEX.CREDIT_CARD, (match) => {
      return '****-****-****-' + match.replace(/[^0-9]/g, '').slice(-4);
    });
    scrubbed = scrubbed.replace(PII_REGEX.EMAIL, (match) => {
      const [local, domain] = match.split('@');
      if (local.length > 2) {
        return `${local[0]}***${local[local.length - 1]}@${domain}`;
      }
      return `***@${domain}`;
    });
    scrubbed = scrubbed.replace(PII_REGEX.SSN, '***-**-****');
    scrubbed = scrubbed.replace(PII_REGEX.PHONE, '[PHONE_REDACTED]');
    scrubbed = scrubbed.replace(PII_REGEX.JWT, '[JWT_TOKEN_REDACTED]');
    scrubbed = scrubbed.replace(PII_REGEX.PRIVATE_KEY, '[PRIVATE_KEY_REDACTED]');
    return scrubbed;
  }
}

export function extractTextFromMcpResult(result?: {
  content?: Array<{ type: string; text?: string }>;
}): string {
  if (!result?.content?.length) return '';
  return result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('\n');
}

const JSON_REFRESH_HOSTNAMES = ['auth.atlassian.com'];

export function inferOAuth2RefreshFormat(tokenUrl?: string): 'form' | 'json' {
  if (!tokenUrl) return 'form';
  try {
    return JSON_REFRESH_HOSTNAMES.includes(new URL(tokenUrl).hostname)
      ? 'json'
      : 'form';
  } catch {
    return 'form';
  }
}

export class PiiScrubProcessor {
  process(data: unknown): unknown {
    return PiiScrubberUtil.scrub(data);
  }
}
