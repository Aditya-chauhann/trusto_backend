import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import {
  WalletsService,
  WalletSeedEntry,
} from '../modules/wallets/wallets.service';

const QR_DIR = resolve(process.cwd(), 'qr');

function loadQrForIndex(i: number): Buffer | undefined {
  const path = resolve(QR_DIR, `wallet-${i}-address.png`);
  if (!existsSync(path)) return undefined;
  return readFileSync(path);
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const config = app.get(ConfigService);
    const walletsService = app.get(WalletsService);

    const cliArg = process.argv[2];
    const relPath =
      cliArg ?? config.get<string>('walletSeedFile') ?? './data/wallets.js';
    const absPath = resolve(process.cwd(), relPath);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(absPath);
    const raw: unknown =
      mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;

    if (!Array.isArray(raw)) {
      throw new Error(
        `Seed file at ${absPath} must export an array of address strings.`,
      );
    }

    const cleaned: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw new Error(
          `Seed file contains a non-string or empty entry: ${JSON.stringify(entry)}`,
        );
      }
      cleaned.push(entry.trim());
    }

    const seenIndexByAddress = new Map<string, number>();
    const entries: WalletSeedEntry[] = [];
    let duplicates = 0;
    let qrFound = 0;
    let qrMissing = 0;
    for (let i = 0; i < cleaned.length; i += 1) {
      const address = cleaned[i];
      if (seenIndexByAddress.has(address)) {
        duplicates += 1;
        continue;
      }
      seenIndexByAddress.set(address, i);
      const qrImage = loadQrForIndex(i);
      if (qrImage) qrFound += 1;
      else qrMissing += 1;
      entries.push({ address, qrImage, qrImageMimeType: 'image/png' });
    }

    if (duplicates > 0) {
      console.warn(
        `Deduplicated ${duplicates} duplicate address(es) from the input file.`,
      );
    }

    console.log(
      `Seeding ${entries.length} address(es) from ${absPath}; QR images found: ${qrFound}, missing: ${qrMissing} (looking in ${QR_DIR})`,
    );

    const { inserted, skipped, qrUpdated } =
      await walletsService.seedAddresses(entries);

    console.log(
      `Done. Inserted: ${inserted}, Skipped (already existed): ${skipped}, QR images written/updated: ${qrUpdated}`,
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', err);
  process.exit(1);
});
