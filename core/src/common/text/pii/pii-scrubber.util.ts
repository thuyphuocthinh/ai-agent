import { regex } from "@agent/core/constants";
import { StrictJsonObject, StrictJsonValue } from '../../types';

/**
 * Utility class to scrub Personally Identifiable Information (PII) and sensitive data
 * from objects and strings before they are sent to external LLMs.
 */
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

  static scrub(data: StrictJsonValue): StrictJsonValue {
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
      const scrubbedObj: StrictJsonObject = {};
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

    scrubbed = scrubbed.replace(regex.PII_CREDIT_CARD, (match) => {
      return '****-****-****-' + match.replace(/[^0-9]/g, '').slice(-4);
    });

    scrubbed = scrubbed.replace(regex.PII_EMAIL, (match) => {
      const [local, domain] = match.split('@');
      if (local.length > 2) {
        return `${local[0]}***${local[local.length - 1]}@${domain}`;
      }
      return `***@${domain}`;
    });

    scrubbed = scrubbed.replace(regex.PII_SSN, '***-**-****');
    scrubbed = scrubbed.replace(regex.PII_PHONE, '[PHONE_REDACTED]');
    scrubbed = scrubbed.replace(regex.PII_JWT, '[JWT_TOKEN_REDACTED]');
    scrubbed = scrubbed.replace(regex.PII_PRIVATE_KEY, '[PRIVATE_KEY_REDACTED]');

    return scrubbed;
  }
}
