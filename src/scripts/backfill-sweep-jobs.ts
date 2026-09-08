/**
 * Backfill Script: Scans all DB wallets for un-swept USDT balances (USDT >= minUsdt)
 * and enqueues them into sweep_jobs so the automatic worker sweeps them to the Collection Vault.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-sweep-jobs.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ConfigService } from '@nestjs/config';
import { TronService } from '../modules/sweep/tron.service';
import { SweepQueueService } from '../modules/sweep/sweep-queue.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { Wallet, WalletDocument } from '../modules/wallets/schemas/wallet.schema';

async function run() {
  console.log('Bootstrapping NestJS application context for Backfill Sweep Jobs...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const config = app.get(ConfigService);
    const tronService = app.get(TronService);
    const sweepQueue = app.get(SweepQueueService);
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const walletModel = app.get<Model<WalletDocument>>(getModelToken(Wallet.name));

    const minUsdt = config.get<number>('sweep.minUsdt') ?? 1;

    console.log('\n========================================================================================');
    console.log(`🔍 SCANNING ALL DB WALLETS FOR UN-SWEPT USDT (Minimum Threshold: ${minUsdt} USDT)...`);
    console.log('========================================================================================');

    // Fetch all wallets from User model and Wallet model
    const [users, wallets] = await Promise.all([
      userModel.find({ walletAddress: { $exists: true, $ne: '' } }).select('walletAddress').exec(),
      walletModel.find({ address: { $exists: true, $ne: '' } }).select('address').exec(),
    ]);

    const userAddrs = users.map((u) => u.walletAddress).filter((addr): addr is string => Boolean(addr));
    const walletAddrs = wallets.map((w) => w.address).filter((addr): addr is string => Boolean(addr));
    const allWalletAddresses: string[] = Array.from(new Set([...userAddrs, ...walletAddrs]));

    if (allWalletAddresses.length === 0) {
      console.log('⚠️ No wallets found in Database!');
      process.exit(0);
      return;
    }

    console.log(`Found total ${allWalletAddresses.length} wallet(s). Querying on-chain balances...\n`);

    let fundedCount = 0;
    let enqueuedCount = 0;
    let totalUsdtToSweep = 0;

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    for (let i = 0; i < allWalletAddresses.length; i += 1) {
      const address = allWalletAddresses[i];
      let usdtBalance = 0;

      try {
        usdtBalance = await tronService.getUsdtBalance(address);
        await delay(350); // Respect rate limit
      } catch (err) {
        await delay(1500);
        try {
          usdtBalance = await tronService.getUsdtBalance(address);
          await delay(350);
        } catch {}
      }

      if (usdtBalance >= minUsdt) {
        fundedCount += 1;
        totalUsdtToSweep += usdtBalance;

        await sweepQueue.enqueue(address);
        enqueuedCount += 1;

        console.log(`[+] Enqueued Wallet #${fundedCount}: ${address} | Balance: ${usdtBalance.toFixed(6)} USDT`);
      }

      if ((i + 1) % 20 === 0 || i === allWalletAddresses.length - 1) {
        process.stdout.write(`... Progress: Checked ${i + 1}/${allWalletAddresses.length} wallets\r`);
      }
    }

    console.log('\n========================================================================================');
    console.log('📊 BACKFILL SUMMARY REPORT');
    console.log('========================================================================================');
    console.log(`Total Wallets Scanned           : ${allWalletAddresses.length}`);
    console.log(`Funded Wallets Found            : ${fundedCount}`);
    console.log(`Jobs Enqueued into sweep_jobs   : ${enqueuedCount}`);
    console.log(`Total USDT Enqueued for Sweep   : ${totalUsdtToSweep.toFixed(6)} USDT`);
    console.log('----------------------------------------------------------------------------------------');
    console.log('✅ Backfill complete! The background SweepWorkerService will now automatically sweep');
    console.log('   these wallets 5 at a time every 30 seconds.');
    console.log('========================================================================================\n');
  } catch (error) {
    console.error('❌ Failed to run backfill sweep jobs:', error);
  }
  process.exit(0);
}

run();
