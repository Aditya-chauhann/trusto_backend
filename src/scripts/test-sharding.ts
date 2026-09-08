import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WalletsService } from '../modules/wallets/wallets.service';
import { Types } from 'mongoose';

async function runTest() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const walletsService = app.get(WalletsService);

    // Create a dummy wallet ID and data
    const dummyWalletId = new Types.ObjectId();
    const dummyAddress = 'T_DummyAddress1234567890abcdefghij';
    const dummyPrivateKey = 'T_DummyPrivateKey_0987654321_secret';

    console.log('--------------------------------------------------');
    console.log(`Testing Sharding for Wallet ID: ${dummyWalletId}`);
    console.log(`Original Address: ${dummyAddress}`);
    console.log(`Original Private Key: ${dummyPrivateKey}`);
    console.log('--------------------------------------------------');

    // 1. Store the private key
    console.log('\n[1] Storing private key (Splitting -> Encrypting -> Saving to 2 DBs)...');
    await walletsService.storePrivateKey(dummyWalletId, dummyAddress, dummyPrivateKey);
    console.log('✅ Successfully stored shards in Database 1 and Database 2.');

    // 2. Reconstruct the private key
    console.log('\n[2] Reconstructing private key (Fetching from 2 DBs -> Decrypting -> Merging)...');
    const reconstructedKey = await walletsService.reconstructPrivateKey(dummyWalletId);
    
    console.log('\n--------------------------------------------------');
    console.log(`Reconstructed Private Key: ${reconstructedKey}`);
    
    if (reconstructedKey === dummyPrivateKey) {
      console.log('✅ SUCCESS: The reconstructed key perfectly matches the original!');
    } else {
      console.error('❌ FAILED: The reconstructed key does NOT match.');
    }
    console.log('--------------------------------------------------');

  } catch (error) {
    console.error('An error occurred during testing:', error);
  } finally {
    console.log('\nClosing application context...');
    await app.close();
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
