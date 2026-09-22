import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');
  const domain = config.get<number>('DOMAIN');

  await app.listen(port);
  Logger.log(`PropFlow running on ${domain}:${port}/api/v1`, 'Bootstrap');
  Logger.log(`Swagger docs on ${domain}:${port}/api/docs`, 'Bootstrap');
}
void bootstrap();
