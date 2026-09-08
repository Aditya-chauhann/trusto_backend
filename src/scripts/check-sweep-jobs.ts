import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SweepJob, SweepJobDocument } from '../modules/sweep/schemas/sweep-job.schema';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const sweepJobModel = app.get<Model<SweepJobDocument>>(getModelToken(SweepJob.name));

    console.log('\n========================================================================================');
    console.log('🔍 SWEEP JOBS DB AUDIT');
    console.log('========================================================================================');

    const counts = await sweepJobModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    console.log('\n📊 Jobs Count by Status:');
    let total = 0;
    for (const c of counts) {
      console.log(` - ${(c._id || 'unknown').padEnd(15, ' ')} : ${c.count}`);
      total += c.count;
    }
    console.log(` - Total Jobs      : ${total}`);

    const pendingJobs = await sweepJobModel
      .find({ status: { $in: ['pending', 'funding_gas', 'sweeping'] } })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    if (pendingJobs.length > 0) {
      console.log('\n----------------------------------------------------------------------------------------');
      console.log(`📋 ACTIVE / PENDING JOBS (Showing ${pendingJobs.length}):`);
      console.log('----------------------------------------------------------------------------------------');
      for (const j of pendingJobs) {
        console.log(
          `ID: ${j._id} | Wallet: ${j.walletAddress} | Status: ${j.status} | Attempts: ${j.attempts}/${j.maxAttempts} | USDT: ${j.usdtAmount ?? 0}`,
        );
      }
    } else {
      console.log('\n✅ No pending or active sweep jobs in database right now.');
    }

    console.log('========================================================================================\n');
  } catch (err) {
    console.error('❌ Failed to check sweep jobs:', err);
  }
  process.exit(0);
}

run();
