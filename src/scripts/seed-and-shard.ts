import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WalletsService } from '../modules/wallets/wallets.service';
import { getModelToken } from '@nestjs/mongoose';
import { Wallet, WalletDocument, WalletStatus } from '../modules/wallets/schemas/wallet.schema';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

async function seedAndShard() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const walletsService = app.get(WalletsService);
    const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name));

    const fileName = process.argv[2] || 'wallets.txt';
    const filePath = path.resolve(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      console.log('Usage: npx ts-node src/scripts/seed-and-shard.ts <path-to-txt-file>');
      process.exit(1);
    }

    console.log(`Reading file: ${filePath}`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    const addressRegex = /Address\s*\(base58\):\s*([a-zA-Z0-9]+)/g;
    const privateKeyRegex = /Private\s*key\s*\(hex\):\s*([a-fA-F0-9]+)/g;

    const addresses = [...fileContent.matchAll(addressRegex)].map((m) => m[1]);
    const privateKeys = [...fileContent.matchAll(privateKeyRegex)].map((m) => m[1]);

    if (addresses.length !== privateKeys.length) {
      console.error('Mismatch in number of addresses and private keys found in the file.');
      process.exit(1);
    }

    if (addresses.length === 0) {
      console.warn('No wallets found in the provided file.');
      process.exit(0);
    }

    console.log(`Found ${addresses.length} wallets. Starting Seed & Shard process...`);

    let newWalletsInserted = 0;
    let walletsAlreadyExisted = 0;
    let keysStored = 0;
    const errorAddresses: string[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      const privateKey = privateKeys[i];

      try {
        // 1. Upsert wallet into main DB (prevents duplicates securely)
        const insertRes = await walletModel.updateOne(
          { address },
          {
            $setOnInsert: {
              address,
              status: WalletStatus.Unused,
              assignedTo: null,
              assignedAt: null,
            },
          },
          { upsert: true }
        );

        if (insertRes.upsertedCount && insertRes.upsertedCount > 0) {
          newWalletsInserted++;
        } else {
          walletsAlreadyExisted++;
        }

        // 2. Fetch the wallet to get its _id
        const wallet = await walletModel.findOne({ address }).select('_id address').exec();

        if (wallet) {
          // 3. Store the private key in shard databases
          await walletsService.storePrivateKey(wallet._id, wallet.address, privateKey);
          keysStored++;
        }

        if ((i + 1) % 100 === 0) {
          console.log(`Progress: Processed ${i + 1} wallets...`);
        }
      } catch (err) {
        console.error(`[ERROR] Failed processing wallet: ${address}`, err);
        errorAddresses.push(address);
      }
    }

    console.log('\n==============================================================================');
    console.log('SEED & SHARD COMPLETE');
    console.log('==============================================================================');
    console.log(`Total Wallets in File    : ${addresses.length}`);
    console.log(`New Wallets Added to DB  : ${newWalletsInserted}`);
    console.log(`Wallets Already in DB    : ${walletsAlreadyExisted}`);
    console.log(`Private Keys Secured     : ${keysStored}`);
    console.log(`Errors                   : ${errorAddresses.length}`);
    console.log('==============================================================================');
    
    if (errorAddresses.length > 0) {
      console.log('\n[!] Addresses that FAILED due to an error:');
      errorAddresses.forEach(addr => console.log(` - ${addr}`));
    }
    console.log('\n');

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await app.close();
  }
}

seedAndShard().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
