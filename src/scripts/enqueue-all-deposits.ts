/**
 * Testing Script: Enqueues all existing deposits from `deposits` DB collection into `sweep_jobs`.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/enqueue-all-deposits.ts
 *   or
 *   npm run sweep:enqueue-deposits
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SweepQueueService } from '../modules/sweep/sweep-queue.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Deposit, DepositDocument } from '../modules/deposits/schemas/deposit.schema';

async function run() {
  console.log('Bootstrapping NestJS application context to enqueue all DB deposits...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const sweepQueue = app.get(SweepQueueService);
    const depositModel = app.get<Model<DepositDocument>>(getModelToken(Deposit.name));

    console.log('\n========================================================================================');
    console.log('🔍 FETCHING ALL DEPOSITS FROM DATABASE...');
    console.log('========================================================================================');

    const deposits = await depositModel.find().sort({ createdAt: 1 }).exec();

    if (deposits.length === 0) {
      console.log('⚠️ No deposits found in database!');
      process.exit(0);
      return;
    }

    console.log(`Found total ${deposits.length} deposit(s) in DB. Processing sweep queue enqueue...\n`);

    let enqueuedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < deposits.length; i += 1) {
      const dep = deposits[i];
      const address = (dep.walletAddress || '').trim();

      if (!address || address === 'MANUAL_ADJUSTMENT') {
        console.log(`[-] Skipped deposit #${i + 1} (tx=${dep.transactionId}): Invalid or MANUAL_ADJUSTMENT wallet address.`);
        skippedCount += 1;
        continue;
      }

      await sweepQueue.enqueue(address, dep._id as Types.ObjectId);
      enqueuedCount += 1;
      console.log(`[+] Enqueued deposit #${i + 1} (tx=${dep.transactionId}): Wallet=${address} Amount=${dep.amount} ${dep.currency}`);
    }

    console.log('\n========================================================================================');
    console.log('📊 ENQUEUE SUMMARY REPORT');
    console.log('========================================================================================');
    console.log(`Total Deposits Processed        : ${deposits.length}`);
    console.log(`Jobs Enqueued into sweep_jobs   : ${enqueuedCount}`);
    console.log(`Deposits Skipped                : ${skippedCount}`);
    console.log('----------------------------------------------------------------------------------------');
    console.log('✅ Done! Run your background server (npm run start:dev) and your Cron Worker');
    console.log('   SweepWorkerService will automatically process these pending sweep jobs!');
    console.log('========================================================================================\n');
  } catch (error) {
    console.error('❌ Failed to enqueue deposits:', error);
  }
  process.exit(0);
}

run();
