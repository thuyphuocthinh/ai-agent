import { stripNineRouterArtifacts } from './router-artifact.util';

describe('stripNineRouterArtifacts', () => {
  it('strips trailing "data: [DONE]" from response text', () => {
    const raw = '{"choices":[]}\ndata: [DONE]';
    const cleaned = stripNineRouterArtifacts(raw);
    expect(cleaned).toBe('{"choices":[]}');
  });

  it('unwraps double-stringified JSON payloads', () => {
    const doubleStringified = JSON.stringify('{"message":"hello world"}');
    const cleaned = stripNineRouterArtifacts(doubleStringified);
    expect(cleaned).toBe('{"message":"hello world"}');
  });

  it('handles both double-stringified payload and trailing [DONE]', () => {
    const inner = '{"status":"ok"}';
    const raw = `${JSON.stringify(inner)}\ndata: [DONE]`;
    const cleaned = stripNineRouterArtifacts(raw);
    expect(cleaned).toBe('{"status":"ok"}');
  });

  it('leaves clean JSON strings intact', () => {
    const normalJson = '{"key":"value","number":123}';
    expect(stripNineRouterArtifacts(normalJson)).toBe(normalJson);
  });

  it('leaves non-JSON strings intact', () => {
    const plainText = 'Hello, this is just plain text.';
    expect(stripNineRouterArtifacts(plainText)).toBe(plainText);
  });
});
