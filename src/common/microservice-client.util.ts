import { Transport, ClientsProviderAsyncOptions } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

export function getMicroserviceClientConfig(
  serviceName: string,
  defaultPort: number,
): ClientsProviderAsyncOptions {
  return {
    name: serviceName,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
      const hostEnvKey = `${serviceName}_HOST`;
      const portEnvKey = `${serviceName}_PORT`;

      return {
        transport: Transport.TCP,
        options: {
          host: configService.get<string>(hostEnvKey, 'localhost'),
          port: configService.get<number>(portEnvKey, defaultPort),
        },
      };
    },
  };
}
