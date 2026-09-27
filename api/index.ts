import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const server = express();
let bootstrapped: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  configureApp(app);
  await app.init();
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  bootstrapped ??= bootstrap();
  await bootstrapped;
  server(req, res);
}
