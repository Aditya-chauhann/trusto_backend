// src/scripts/migrate-wallets.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { Wallet, WalletDocument, WalletStatus } from '../modules/wallets/schemas/wallet.schema';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { WalletsService } from '../modules/wallets/wallets.service';

/**
 * Migration script to replace existing wallets (TR1‑TR10) with a new set of wallets.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-wallets.ts <path-to-wallets.txt> [--dry]
 *
 * The wallet file must contain lines like:
 *   Address (base58): <address>
 *   Private key (hex): <privateKey>
 *
 * The script will:
 *   1. Parse the file and collect address / privateKey pairs.
 *   2. For each of the first 10 entries, locate the user with serialId TR1‑TR10.
 *   3. Mark the user's current wallet as `Replaced` (soft‑delete).
 *   4. Upsert the new wallet with status `Assigned` and link it to the user.
 *   5. Store the private key shards via WalletsService.
 *   6. Update the user's `walletAddress` field.
 *   7. Log a concise summary.
 */

async function migrate() {
  const args = process.argv.slice(2);
  const filePathArg = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry');

  if (!filePathArg) {
    console.error('Error: Path to wallets file is required.');
    console.log('Usage: npx ts-node src/scripts/migrate-wallets.ts <path-to-wallets.txt> [--dry]');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), filePathArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const addressRegex = /Address\s*\(base58\):\s*([a-zA-Z0-9]+)/g;
  const privateKeyRegex = /Private\s*key\s*\(hex\):\s*([a-fA-F0-9]+)/g;
  const addresses = [...content.matchAll(addressRegex)].map((m) => m[1]);
  const privateKeys = [...content.matchAll(privateKeyRegex)].map((m) => m[1]);

  if (addresses.length !== privateKeys.length) {
    console.error('Mismatch between number of addresses and private keys.');
    process.exit(1);
  }

  const maxUsers = 10; // TR1‑TR10
  const count = Math.min(maxUsers, addresses.length);

  console.log('Bootstrapping NestJS context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name));
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  const walletsService = app.get(WalletsService);

  let processed = 0;
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const serialId = `TR${i + 1}`;
    const newAddress = addresses[i];
    const newPrivateKey = privateKeys[i];

    try {
      const user = await userModel.findOne({ serialId }).exec();
      if (!user) {
        console.warn(`User with serialId ${serialId} not found – skipping.`);
        continue;
      }

      const oldAddress = user.walletAddress;

      if (!dryRun) {
        // Mark old wallet as replaced
        if (oldAddress) {
          await walletModel.updateOne({ address: oldAddress }, { $set: { status: WalletStatus.Replaced } }).exec();
        }

        // Upsert new wallet and assign to user
        await walletModel.updateOne(
          { address: newAddress },
          {
            $setOnInsert: {
              address: newAddress,
              status: WalletStatus.Assigned,
              assignedTo: user._id,
              assignedAt: new Date(),
            },
            $set: {
              status: WalletStatus.Assigned,
              assignedTo: user._id,
              assignedAt: new Date(),
            },
          },
          { upsert: true },
        ).exec();

        // Retrieve the wallet document to get its _id
        const walletDoc = await walletModel.findOne({ address: newAddress }).exec();
        if (!walletDoc) throw new Error('Failed to retrieve newly upserted wallet');

        // Store private key shards
        await walletsService.storePrivateKey(walletDoc._id, newAddress, newPrivateKey);

        // Update user's walletAddress field
        await userModel.updateOne({ _id: user._id }, { $set: { walletAddress: newAddress } }).exec();
      }

      processed++;
      console.log(`✔ Processed ${serialId}: replaced ${oldAddress || '(none)'} with ${newAddress}`);
    } catch (e) {
      const msg = `Failed processing ${serialId}: ${(e as Error).message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total users targeted: ${maxUsers}`);
  console.log(`Successfully processed: ${processed}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));

  await app.close();
}

migrate().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
