import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from '../../application/integrations.service';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;
  let mockIntegrationsService: jest.Mocked<IntegrationsService>;

  beforeEach(async () => {
    mockIntegrationsService = {
      getStatuses: jest.fn().mockResolvedValue([
        {
          providerId: 'github',
          name: 'GitHub',
          type: 'oauth2',
          description: 'Repo integration',
          isConnected: true,
          status: 'connected',
          connectedAt: '2026-10-28T10:00:00Z',
        },
      ]),
      initiate: jest.fn().mockResolvedValue({
        provider: 'github',
        authUrl: 'https://github.com/login/oauth/authorize?state=123',
      }),
      submitCredentials: jest.fn().mockResolvedValue({
        success: true,
        message: 'Saved',
      }),
      disconnect: jest.fn().mockResolvedValue({
        success: true,
        message: 'Disconnected',
      }),
    } as unknown as jest.Mocked<IntegrationsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: IntegrationsService, useValue: mockIntegrationsService },
      ],
    }).compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
  });

  it('should delegate getStatus to IntegrationsService', async () => {
    const res = await controller.getStatus({ ownerId: 'user-1' });

    expect(mockIntegrationsService.getStatuses).toHaveBeenCalledWith('user-1');
    expect(res).toHaveLength(1);
    expect(res[0].providerId).toBe('github');
  });

  it('should delegate initiate to IntegrationsService', async () => {
    const res = await controller.initiate({ provider: 'github', ownerId: 'user-1' });

    expect(mockIntegrationsService.initiate).toHaveBeenCalledWith('github', 'user-1');
    expect(res.authUrl).toContain('https://github.com');
  });

  it('should delegate submit to IntegrationsService', async () => {
    const dto = {
      provider: 'sql_server',
      ownerId: 'user-1',
      credentials: { host: 'localhost' },
    };
    const res = await controller.submit(dto);

    expect(mockIntegrationsService.submitCredentials).toHaveBeenCalledWith(dto);
    expect(res.success).toBe(true);
  });

  it('should delegate disconnect to IntegrationsService', async () => {
    const res = await controller.disconnect('github', { ownerId: 'user-1' });

    expect(mockIntegrationsService.disconnect).toHaveBeenCalledWith('github', 'user-1');
    expect(res.success).toBe(true);
  });
});
