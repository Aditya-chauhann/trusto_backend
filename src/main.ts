import 'dotenv/config';
import * as dns from 'node:dns';

// Fix for Windows / ISP DNS failing to resolve MongoDB Atlas SRV records (querySrv ECONNREFUSED)
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch {
  // Ignore if not supported in environment
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is required to HMAC-verify the payout-bridge callback signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);
  expressApp.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });
  const config = app.get(ConfigService);
  // CORS: allow all origins for now. `origin: true` reflects the request origin
  // back, which allows every origin while still working with credentials —
  // unlike a literal "*", which browsers reject on credentialed requests.
  app.enableCors({

    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Client-Network-IP',
      'X-Client-IP',
      'X-Network-IP',
      'X-Forwarded-For',
    ],
    optionsSuccessStatus: 204,
    origin: ['http://localhost:1008', 'http://localhost:1007','http://192.168.12.28:1007', 'https://trusto.exchange', 'http://trusto.club', 'http://trusto.com.co', 'http://trusto.digital', 'http://trusto.vip', 'http://trusto.pro', 'http://trusto.live', 'http://trusto.biz'],

  });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`TrustO backend listening on port ${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start TrustO backend:', err);
  process.exit(1);
});
  