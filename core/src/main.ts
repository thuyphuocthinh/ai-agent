import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@agent/core/common';
import { OrchestrationModule } from './orchestration.module';
import { ValidationPipe } from '@nestjs/common';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(OrchestrationModule, {
    logger: WinstonModule.createLogger(getLoggerConfig('ORCHESTRATION')),
  });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`Agent core engine listening on port ${port}`);
}

bootstrap();
