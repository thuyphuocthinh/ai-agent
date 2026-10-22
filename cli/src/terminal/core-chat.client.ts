import {
  ChatTurnResponse,
  CoreChatClientOptions,
  UiChunk,
} from './terminal-chat.types';

export class CoreChatClient {
  private readonly coreUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: CoreChatClientOptions) {
    this.coreUrl = (options?.coreUrl ?? process.env.CORE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  getCoreUrl(): string {
    return this.coreUrl;
  }

  async chat(prompt: string, sessionId?: string): Promise<ChatTurnResponse> {
    const url = `${this.coreUrl}/api/chat`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, sessionId }),
    });

    if (!response.ok || !response.body) {
      const errText = await this.extractError(response);
      throw new Error(`Core Server error (HTTP ${response.status}): ${errText}`);
    }

    const returnedSession = response.headers.get('x-playground-session') || sessionId || '';
    return {
      sessionId: returnedSession,
      chunks: this.parseSseStream(response),
    };
  }

  async approve(
    sessionId: string,
    messageId: string,
    action: 'approve' | 'reject',
  ): Promise<AsyncIterable<UiChunk>> {
    const url = `${this.coreUrl}/api/approve`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, messageId, action }),
    });

    if (!response.ok || !response.body) {
      const errText = await this.extractError(response);
      throw new Error(`Core Server error (HTTP ${response.status}): ${errText}`);
    }

    return this.parseSseStream(response);
  }

  private async *parseSseStream(response: Response): AsyncIterable<UiChunk> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const raw of events) {
          const lines = raw.split('\n');
          const dataLine = lines
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('');

          if (!dataLine || dataLine === '[DONE]') continue;

          try {
            const chunk = JSON.parse(dataLine) as UiChunk;
            yield chunk;
          } catch {
            // Skip non-json lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async extractError(response: Response): Promise<string> {
    try {
      const json = await response.json() as Record<string, unknown>;
      return String(json.error || json.message || response.statusText);
    } catch {
      return response.statusText || 'Unknown error';
    }
  }
}
