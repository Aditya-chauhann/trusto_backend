import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WalletsService } from '../modules/wallets/wallets.service';
import { getModelToken } from '@nestjs/mongoose';
import { Wallet, WalletDocument, WalletStatus } from '../modules/wallets/schemas/wallet.schema';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

interface ParsedWallet {
  address: string;
  privateKey?: string;
}

function parseWalletFile(content: string): ParsedWallet[] {
  const trimmed = content.trim();
  const results: ParsedWallet[] = [];

  // Format 1: JSON array
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.startsWith('T') && item.length === 34) {
            results.push({ address: item.trim() });
          } else if (item && typeof item === 'object') {
            const addr = item.address || item.walletAddress || item.addr;
            const pk = item.privateKey || item.pk || item.private_key || item.key;
            if (addr && typeof addr === 'string') {
              results.push({ address: addr.trim(), privateKey: pk ? String(pk).trim() : undefined });
            }
          }
        }
        if (results.length > 0) return results;
      }
    } catch {
      // Not JSON, continue to other parsers
    }
  }

  // Format 2: "Address (base58): ... \n Private key (hex): ..."
  const addressRegex = /Address\s*\(base58\):\s*([a-zA-Z0-9]+)/gi;
  const privateKeyRegex = /Private\s*key\s*\(hex\):\s*([a-fA-F0-9]+)/gi;

  const addresses = [...content.matchAll(addressRegex)].map((m) => m[1].trim());
  const privateKeys = [...content.matchAll(privateKeyRegex)].map((m) => m[1].trim());

  if (addresses.length > 0) {
    for (let i = 0; i < addresses.length; i++) {
      results.push({
        address: addresses[i],
        privateKey: privateKeys[i] ?? undefined,
      });
    }
    return results;
  }

  // Format 3: Line-by-line (e.g. CSV, TSV, "Address:PrivateKey", "Address,PrivateKey", or just Address)
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;

    // Check comma or colon or tab separator
    const parts = l.split(/[,:\t| ]+/);
    if (parts.length >= 2) {
      const addr = parts[0].trim();
      const pk = parts[1].trim();
      if (addr.startsWith('T') && addr.length === 34) {
        results.push({ address: addr, privateKey: pk });
        continue;
      }
    }

    // Single Tron address per line
    if (l.startsWith('T') && l.length === 34) {
      results.push({ address: l });
    }
  }

  return results;
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const walletsService = app.get(WalletsService);
    const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name));

    const fileName = process.argv[2] || 'wallet.txt';
    const filePath = path.resolve(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`\n❌ File not found at: ${filePath}`);
      console.log('\nUsage:');
      console.log('  npx ts-node src/scripts/import-wallets.ts <file_path>');
      console.log('Example:');
      console.log('  npx ts-node src/scripts/import-wallets.ts wallet.txt\n');
      process.exit(1);
    }

    console.log(`\n📂 Reading file: ${filePath}`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsedWallets = parseWalletFile(fileContent);

    if (parsedWallets.length === 0) {
      console.error('❌ Could not find any valid Tron wallet addresses in the file.');
      process.exit(1);
    }

    console.log(`🔍 Detected ${parsedWallets.length} wallet(s) to process.`);

    let insertedCount = 0;
    let existingCount = 0;
    let keysStoredCount = 0;
    let errorCount = 0;

    for (let i = 0; i < parsedWallets.length; i++) {
      const { address, privateKey } = parsedWallets[i];

      try {
        // 1. Upsert wallet in the main collection with status 'unused'
        const upsertRes = await walletModel.updateOne(
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

        if (upsertRes.upsertedCount && upsertRes.upsertedCount > 0) {
          insertedCount++;
        } else {
          existingCount++;
        }

        // 2. If private key is present, encrypt and store in shard DBs
        if (privateKey) {
          const walletDoc = await walletModel.findOne({ address }).select('_id address').exec();
          if (walletDoc) {
            await walletsService.storePrivateKey(walletDoc._id, walletDoc.address, privateKey);
            keysStoredCount++;
          }
        }

        if ((i + 1) % 100 === 0 || i + 1 === parsedWallets.length) {
          console.log(`⏳ Progress: ${i + 1}/${parsedWallets.length} processed...`);
        }
      } catch (err) {
        errorCount++;
        console.error(`⚠️ Error processing wallet ${address}:`, err instanceof Error ? err.message : err);
      }
    }

    // Check pool status
    const unusedCount = await walletModel.countDocuments({ status: WalletStatus.Unused });
    const assignedCount = await walletModel.countDocuments({ status: WalletStatus.Assigned });

    console.log('\n================================================================');
    console.log('🎉 WALLET IMPORT SUMMARY');
    console.log('================================================================');
    console.log(`✅ Newly Added Wallets:       ${insertedCount}`);
    console.log(`ℹ️ Already Existed in DB:     ${existingCount}`);
    console.log(`🔐 Private Keys Encrypted:     ${keysStoredCount}`);
    if (errorCount > 0) {
      console.log(`⚠️ Failed:                    ${errorCount}`);
    }
    console.log('----------------------------------------------------------------');
    console.log(`📊 CURRENT POOL STATUS:`);
    console.log(`   🟢 Available (Unused):     ${unusedCount}`);
    console.log(`   👤 Assigned to Users:      ${assignedCount}`);
    console.log(`   📦 Total Wallets in DB:    ${unusedCount + assignedCount}`);
    console.log('================================================================\n');

  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('Fatal error during wallet import:', err);
  process.exit(1);
});
