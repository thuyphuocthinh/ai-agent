import { Injectable, Logger } from '@nestjs/common';
import type {
  ProviderCapabilityCheckResult,
  UserConnectionProfile,
  IUserConnectionResolver,
} from '../security.interface';
import {
  EPreflightStatus,
  EProviderAuthType,
} from '../constants/security.constants';

/**
 * Capability-Driven Pre-flight Guard:
 * Kiểm tra tính sẵn sàng của công cụ dựa trên phương thức xác thực (EProviderAuthType).
 * Loại bỏ hoàn toàn danh sách hardcoded provider tĩnh trong Core.
 */
@Injectable()
export class ProviderPreflightGuard {
  private readonly logger = new Logger(ProviderPreflightGuard.name);
  private connectionResolver?: IUserConnectionResolver;

  // Các provider mock mặc định sẵn sàng khi chạy chế độ MOCK_TOOLS (Playground / Dev)
  private readonly MOCK_BUILTIN_PROVIDERS = new Set([
    'sql_server',
    'google_mail',
    'google_sheets',
    'slack',
    'github',
  ]);

  // Mock in-memory lưu trữ cấu hình kết nối khi chạy cục bộ / test
  private readonly inMemoryConnections = new Map<string, UserConnectionProfile>();

  constructor() {}

  /**
   * Thiết lập resolver tùy biến từ bên ngoài (Database Repository hoặc OAuth Service).
   */
  setConnectionResolver(resolver: IUserConnectionResolver): void {
    this.connectionResolver = resolver;
  }

  /**
   * Đăng ký nhanh kết nối của người dùng (dùng cho test hoặc in-memory profile).
   */
  registerUserConnection(userId: string, profile: UserConnectionProfile): void {
    const key = `${userId}:${profile.provider.toLowerCase()}`;
    this.inMemoryConnections.set(key, profile);
  }

  /**
   * Kiểm tra tính sẵn sàng của Provider và Scopes trước khi agent thực thi tool.
   * - SYSTEM / PUBLIC: Luôn sẵn sàng, không đòi hỏi OAuth của người dùng.
   * - OAUTH2: Kiểm tra kết nối và scopes trong Token Vault.
   * - API_KEY: Kiểm tra cấu hình key hoặc profile kết nối.
   */
  async check(
    userId: string,
    provider: string,
    requiredScopes: string[] = [],
    authType: EProviderAuthType = EProviderAuthType.OAUTH2,
  ): Promise<ProviderCapabilityCheckResult> {
    const normalizedProvider = provider.toLowerCase();

    // 1. Dịch vụ hạ tầng nội bộ (SYSTEM) hoặc tài nguyên công khai (PUBLIC)
    if (
      authType === EProviderAuthType.SYSTEM ||
      authType === EProviderAuthType.PUBLIC
    ) {
      return {
        ready: true,
        reason: EPreflightStatus.READY,
        provider: normalizedProvider,
      };
    }

    const isMockMode = process.env.MOCK_TOOLS === 'true';
    const profile = await this.resolveProfile(userId, normalizedProvider);

    // 2. Kiểm tra tài khoản đã kết nối chưa
    if (!profile) {
      if (isMockMode && this.MOCK_BUILTIN_PROVIDERS.has(normalizedProvider)) {
        return {
          ready: true,
          reason: EPreflightStatus.READY,
          provider: normalizedProvider,
        };
      }

      const connectUrl = `/oauth/${normalizedProvider}/connect?userId=${encodeURIComponent(userId)}`;

      this.logger.warn(
        `Người dùng ${userId} chưa kết nối tới provider "${normalizedProvider}". Cần điều hướng: ${connectUrl}`,
      );

      return {
        ready: false,
        reason: EPreflightStatus.PROVIDER_NOT_CONNECTED,
        provider: normalizedProvider,
        connectUrl,
      };
    }

    if (!profile.isConnected) {
      const connectUrl =
        profile.connectUrl ||
        `/oauth/${normalizedProvider}/connect?userId=${encodeURIComponent(userId)}`;

      this.logger.warn(
        `Người dùng ${userId} chưa kết nối tới provider "${normalizedProvider}". Cần điều hướng: ${connectUrl}`,
      );

      return {
        ready: false,
        reason: EPreflightStatus.PROVIDER_NOT_CONNECTED,
        provider: normalizedProvider,
        connectUrl,
      };
    }

    // 3. Kiểm tra các OAuth Scopes bắt buộc
    if (requiredScopes.length > 0) {
      const granted = new Set(profile.grantedScopes || []);
      const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));

      if (missingScopes.length > 0) {
        const reauthUrl = `/oauth/${normalizedProvider}/authorize?userId=${encodeURIComponent(
          userId,
        )}&scopes=${encodeURIComponent(missingScopes.join(' '))}`;

        this.logger.warn(
          `Người dùng ${userId} thiếu scopes [${missingScopes.join(', ')}] trên provider "${normalizedProvider}"`,
        );

        return {
          ready: false,
          reason: EPreflightStatus.MISSING_OAUTH_SCOPE,
          provider: normalizedProvider,
          missingScopes,
          reauthUrl,
        };
      }
    }

    return {
      ready: true,
      reason: EPreflightStatus.READY,
      provider: normalizedProvider,
    };
  }

  /**
   * Tạo thông điệp hướng dẫn người dùng kết nối hoặc cấp quyền tương tác trực tiếp.
   */
  formatActionableMessage(checkResult: ProviderCapabilityCheckResult): string {
    if (checkResult.ready) {
      return 'Kết nối dịch vụ hợp lệ.';
    }

    if (checkResult.reason === EPreflightStatus.PROVIDER_NOT_CONNECTED) {
      const providerName = checkResult.provider || 'Dịch vụ bên thứ ba';
      return `⚠️ Bạn chưa liên kết tài khoản **${providerName}** với hệ thống.\n👉 [Bấm vào đây để kết nối tài khoản ${providerName}](${checkResult.connectUrl})`;
    }

    if (checkResult.reason === EPreflightStatus.MISSING_OAUTH_SCOPE) {
      const providerName = checkResult.provider || 'Dịch vụ bên thứ ba';
      const scopes = checkResult.missingScopes?.join(', ') || '';
      return `⚠️ Tài khoản **${providerName}** của bạn chưa được cấp quyền thao tác: \`${scopes}\`.\n👉 [Bấm vào đây để nâng cấp quyền hạn](${checkResult.reauthUrl})`;
    }

    return 'Yêu cầu không thể thực hiện do thiếu quyền hạn từ nhà cung cấp.';
  }

  private async resolveProfile(
    userId: string,
    provider: string,
  ): Promise<UserConnectionProfile | null> {
    if (this.connectionResolver) {
      return this.connectionResolver.getUserConnection(userId, provider);
    }
    const key = `${userId}:${provider}`;
    return this.inMemoryConnections.get(key) || null;
  }
}
