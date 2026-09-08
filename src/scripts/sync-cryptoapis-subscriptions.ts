import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CryptoApisSubscriptionsService } from '../modules/cryptoapis/cryptoapis-subscriptions.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const subscriptions = app.get(CryptoApisSubscriptionsService);
    const concurrencyArg = process.argv[2];
    const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : 8;
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error('Concurrency must be a positive integer');
    }

    console.log(
      `Syncing CryptoAPIs subscriptions for all wallet addresses (concurrency=${concurrency})...`,
    );

    const result = await subscriptions.syncAllAddresses(concurrency);

    console.log(
      `Done. Created: ${result.created}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
    );

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('CryptoAPIs subscription sync failed:', err);
  process.exit(1);
});
