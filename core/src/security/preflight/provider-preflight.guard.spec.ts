import { ProviderPreflightGuard } from './provider-preflight.guard';
import {
  EPreflightStatus,
  EProviderAuthType,
} from '../constants/security.constants';

describe('ProviderPreflightGuard', () => {
  let guard: ProviderPreflightGuard;

  beforeEach(() => {
    guard = new ProviderPreflightGuard();
  });

  it('returns PROVIDER_NOT_CONNECTED when user has not connected provider with OAUTH2', async () => {
    const result = await guard.check('user-1', 'shopify');

    expect(result.ready).toBe(false);
    expect(result.reason).toBe(EPreflightStatus.PROVIDER_NOT_CONNECTED);
    expect(result.connectUrl).toContain('/oauth/shopify/connect?userId=user-1');
  });

  it('returns MISSING_OAUTH_SCOPE when user lacks required scopes', async () => {
    guard.registerUserConnection('user-1', {
      provider: 'shopify',
      isConnected: true,
      grantedScopes: ['read_products'],
    });

    const result = await guard.check('user-1', 'shopify', [
      'read_products',
      'write_orders',
    ]);

    expect(result.ready).toBe(false);
    expect(result.reason).toBe(EPreflightStatus.MISSING_OAUTH_SCOPE);
    expect(result.missingScopes).toEqual(['write_orders']);
    expect(result.reauthUrl).toContain('write_orders');
  });

  it('returns READY when provider is connected with all required scopes', async () => {
    guard.registerUserConnection('user-1', {
      provider: 'shopify',
      isConnected: true,
      grantedScopes: ['read_products', 'write_orders', 'refunds'],
    });

    const result = await guard.check('user-1', 'shopify', [
      'read_products',
      'write_orders',
    ]);

    expect(result.ready).toBe(true);
    expect(result.reason).toBe(EPreflightStatus.READY);
  });

  it('returns READY when authType is SYSTEM or PUBLIC without requiring OAuth or connection profile', async () => {
    const sysResult = await guard.check(
      'user-1',
      'arbitrary_internal_db',
      ['read_query'],
      EProviderAuthType.SYSTEM,
    );
    expect(sysResult.ready).toBe(true);
    expect(sysResult.reason).toBe(EPreflightStatus.READY);
    expect(sysResult.provider).toBe('arbitrary_internal_db');

    const pubResult = await guard.check(
      'user-1',
      'weather_api',
      [],
      EProviderAuthType.PUBLIC,
    );
    expect(pubResult.ready).toBe(true);
    expect(pubResult.reason).toBe(EPreflightStatus.READY);
    expect(pubResult.provider).toBe('weather_api');
  });

  it('returns READY for built-in mock providers when MOCK_TOOLS=true', async () => {
    const prev = process.env.MOCK_TOOLS;
    process.env.MOCK_TOOLS = 'true';
    try {
      const result = await guard.check('user-1', 'google_mail', ['search_emails']);
      expect(result.ready).toBe(true);
      expect(result.reason).toBe(EPreflightStatus.READY);

      const computeResult = await guard.check('user-1', 'compute', []);
      expect(computeResult.ready).toBe(true);
      expect(computeResult.reason).toBe(EPreflightStatus.READY);
    } finally {
      process.env.MOCK_TOOLS = prev;
    }
  });

  it('formats actionable messages accurately for disconnected or missing scope states', () => {
    const disconnectedMsg = guard.formatActionableMessage({
      ready: false,
      reason: EPreflightStatus.PROVIDER_NOT_CONNECTED,
      provider: 'shopify',
      connectUrl: '/oauth/shopify/connect?userId=u1',
    });
    expect(disconnectedMsg).toContain('Bấm vào đây để kết nối tài khoản shopify');

    const missingScopesMsg = guard.formatActionableMessage({
      ready: false,
      reason: EPreflightStatus.MISSING_OAUTH_SCOPE,
      provider: 'shopify',
      missingScopes: ['write_orders'],
      reauthUrl: '/oauth/shopify/authorize?scopes=write_orders',
    });
    expect(missingScopesMsg).toContain('write_orders');
    expect(missingScopesMsg).toContain('Bấm vào đây để nâng cấp quyền hạn');

    const readyMsg = guard.formatActionableMessage({ ready: true });
    expect(readyMsg).toContain('Kết nối dịch vụ hợp lệ.');
  });
});
