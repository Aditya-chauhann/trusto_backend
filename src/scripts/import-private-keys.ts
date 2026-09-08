import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WalletsService } from '../modules/wallets/wallets.service';
import { getModelToken } from '@nestjs/mongoose';
import { Wallet, WalletDocument } from '../modules/wallets/schemas/wallet.schema';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

async function importPrivateKeys() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const walletsService = app.get(WalletsService);
    // Get the Wallet model directly to find wallets by address
    const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name)); 

    // Accept file path from command line arguments, default to 'wallets.txt'
    const fileName = process.argv[2] || 'wallets.txt';
    const filePath = path.resolve(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      console.log('Usage: npx ts-node src/scripts/import-private-keys.ts <path-to-txt-file>');
      process.exit(1);
    }

    console.log(`Reading file: ${filePath}`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // Regex to match Address and Private key
    // Matches: Address (base58): TZD...
    // Matches: Private key (hex): fae3...
    const addressRegex = /Address\s*\(base58\):\s*([a-zA-Z0-9]+)/g;
    const privateKeyRegex = /Private\s*key\s*\(hex\):\s*([a-fA-F0-9]+)/g;

    const addresses = [...fileContent.matchAll(addressRegex)].map((m) => m[1]);
    const privateKeys = [...fileContent.matchAll(privateKeyRegex)].map((m) => m[1]);

    if (addresses.length !== privateKeys.length) {
      console.error('Mismatch in number of addresses and private keys found in the file.');
      console.error(`Found ${addresses.length} addresses and ${privateKeys.length} private keys.`);
      process.exit(1);
    }

    if (addresses.length === 0) {
      console.warn('No wallets found in the provided file.');
      process.exit(0);
    }

    console.log(`Found ${addresses.length} wallets to process. Starting import...`);

    let successCount = 0;
    const missingAddresses: string[] = [];
    const errorAddresses: string[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      const privateKey = privateKeys[i];

      try {
        // 1. Find the wallet in the main database
        const wallet = await walletModel.findOne({ address }).exec();

        if (!wallet) {
          missingAddresses.push(address);
          continue;
        }

        // 2. Store the private key (shards and encrypts automatically)
        await walletsService.storePrivateKey(wallet._id, wallet.address, privateKey);
        successCount++;
        if (successCount % 100 === 0) {
           console.log(`Progress: Processed ${successCount} wallets...`);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to store private key for: ${address}`, err);
        errorAddresses.push(address);
      }
    }

    console.log('\n==============================================================================');
    console.log('IMPORT COMPLETE');
    console.log('==============================================================================');
    console.log(`Total Found in File : ${addresses.length}`);
    console.log(`Successfully Stored : ${successCount}`);
    console.log(`Not Found in DB     : ${missingAddresses.length}`);
    console.log(`Errors              : ${errorAddresses.length}`);
    console.log('==============================================================================');
    
    if (missingAddresses.length > 0) {
      console.log('\n[!] Addresses NOT FOUND in main database:');
      missingAddresses.forEach(addr => console.log(` - ${addr}`));
    }

    if (errorAddresses.length > 0) {
      console.log('\n[!] Addresses that FAILED due to an error:');
      errorAddresses.forEach(addr => console.log(` - ${addr}`));
    }
    console.log('\n');

  } catch (error) {
    console.error('An error occurred during import:', error);
  } finally {
    await app.close();
  }
}

importPrivateKeys().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
