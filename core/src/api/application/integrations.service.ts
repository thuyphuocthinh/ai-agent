import { Injectable, Logger, Optional } from '@nestjs/common';
import { McpAuthClientService } from '../../infrastructure/tools/mcp/mcp-auth-client.service';
import { NativeToolRegistryService } from '../../infrastructure/tools/native/native-tool-registry.service';
import { ProviderStatusDto } from '../../contracts/dtos/mcp-auth.dto';
import {
  InitiateIntegrationResponseDto,
  IntegrationActionResponseDto,
  IntegrationFormFieldDto,
  IntegrationStatusItemDto,
  SubmitIntegrationCredentialsDto,
} from '../presentation/dtos/integrations.dto';

interface ProviderMetadata {
  name: string;
  type: 'oauth2' | 'form' | 'native';
  description: string;
  fields?: IntegrationFormFieldDto[];
}

export const DEFAULT_INTEGRATION_OWNER_ID = 'default_user';

export const INTEGRATION_PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  github: {
    name: 'GitHub',
    type: 'oauth2',
    description: 'Tương tác với kho mã nguồn, đọc/tạo Pull Request và Issue',
  },
  google_sheets: {
    name: 'Google Sheets',
    type: 'oauth2',
    description: 'Truy vấn, trích xuất và cập nhật dữ liệu bảng tính Google Sheets',
  },
  slack: {
    name: 'Slack',
    type: 'oauth2',
    description: 'Gửi tin nhắn thông báo và tra cứu lịch sử thảo luận các kênh Slack',
  },
  sql_server: {
    name: 'SQL Server / Business DB',
    type: 'form',
    description: 'Truy vấn SQL dữ liệu kinh doanh (đơn hàng, khách hàng, doanh thu)',
    fields: [
      { name: 'host', label: 'Database Host', type: 'text', required: true, placeholder: 'localhost hoặc 127.0.0.1' },
      { name: 'port', label: 'Port', type: 'text', required: false, placeholder: '1433' },
      { name: 'user', label: 'Username', type: 'text', required: true, placeholder: 'sa' },
      { name: 'password', label: 'Password', type: 'password', required: true },
      { name: 'database', label: 'Database Name', type: 'text', required: true, placeholder: 'ecommerce_db' },
    ],
  },
  mail: {
    name: 'SMTP Mailer',
    type: 'form',
    description: 'Gửi email báo cáo định kỳ và thông báo giao dịch',
    fields: [
      { name: 'host', label: 'SMTP Host', type: 'text', required: true, placeholder: 'smtp.gmail.com' },
      { name: 'port', label: 'SMTP Port', type: 'text', required: true, placeholder: '587' },
      { name: 'user', label: 'Username / Email', type: 'text', required: true },
      { name: 'password', label: 'Password / App Password', type: 'password', required: true },
    ],
  },
  kintone: {
    name: 'Cybozu Kintone',
    type: 'form',
    description: 'Tra cứu thông tin khách hàng CRM và quản lý hồ sơ nội bộ',
    fields: [
      { name: 'subdomain', label: 'Kintone Subdomain', type: 'text', required: true, placeholder: 'my-company' },
      { name: 'apiToken', label: 'API Token', type: 'password', required: true },
    ],
  },
};

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    @Optional()
    private readonly nativeToolRegistry?: NativeToolRegistryService,
  ) {}

  async getStatuses(ownerId: string = DEFAULT_INTEGRATION_OWNER_ID): Promise<IntegrationStatusItemDto[]> {
    const authStatuses = await this.mcpAuthClient.getConnectionStatus(ownerId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to retrieve connection statuses from mcp_auth for ${ownerId}: ${message}`);
      return [] as ProviderStatusDto[];
    });

    const statusMap = new Map<string, ProviderStatusDto>(
      authStatuses.map((s): [string, ProviderStatusDto] => [s.provider_id, s]),
    );

    const result: IntegrationStatusItemDto[] = [];

    // 1. Static MCP & Form Providers
    for (const [providerId, meta] of Object.entries(INTEGRATION_PROVIDER_METADATA)) {
      const authInfo = statusMap.get(providerId);
      result.push({
        providerId,
        name: meta.name,
        type: meta.type,
        description: meta.description,
        isConnected: authInfo?.is_connected ?? false,
        status: authInfo?.status ?? 'disconnected',
        connectedAt: authInfo?.connected_at ?? null,
        fields: meta.fields,
      });
    }

    // 2. Native Tools
    if (this.nativeToolRegistry) {
      const nativeTools = this.nativeToolRegistry.getAllTools();
      if (nativeTools.length > 0) {
        result.push({
          providerId: 'native_business_db',
          name: 'Native Business Tools',
          type: 'native',
          description: `Tích hợp ${nativeTools.length} native tool nghiệp vụ chạy trực tiếp trong Engine`,
          isConnected: true,
          status: 'connected',
          connectedAt: new Date().toISOString(),
        });
      }
    }

    return result;
  }

  async initiate(
    provider: string,
    ownerId: string = DEFAULT_INTEGRATION_OWNER_ID,
  ): Promise<InitiateIntegrationResponseDto> {
    const meta = INTEGRATION_PROVIDER_METADATA[provider];
    if (meta?.type === 'form') {
      return {
        provider,
        fields: meta.fields,
      };
    }

    const connectRes = await this.mcpAuthClient.initiateConnect({
      ownerId,
      provider,
    });

    return {
      provider,
      authUrl: connectRes.auth_url,
    };
  }

  async submitCredentials(
    dto: SubmitIntegrationCredentialsDto,
  ): Promise<IntegrationActionResponseDto> {
    const ownerId = dto.ownerId ?? DEFAULT_INTEGRATION_OWNER_ID;
    await this.mcpAuthClient.submitCredentials({
      ownerId,
      provider: dto.provider,
      credentials: dto.credentials,
    });

    return {
      success: true,
      message: `Đã lưu cấu hình kết nối cho "${dto.provider}" thành công.`,
    };
  }

  async disconnect(
    provider: string,
    ownerId: string = DEFAULT_INTEGRATION_OWNER_ID,
  ): Promise<IntegrationActionResponseDto> {
    await this.mcpAuthClient.disconnectProvider(ownerId, provider);

    return {
      success: true,
      message: `Đã hủy kết nối "${provider}" thành công.`,
    };
  }
}
