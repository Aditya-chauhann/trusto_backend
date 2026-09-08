/**
 * Verifies sweep configuration and optionally prints on-chain balances.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/verify-sweep-config.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/verify-sweep-config.ts TWalletAddress...
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ConfigService } from '@nestjs/config';
import { TronService } from '../modules/sweep/tron.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const config = app.get(ConfigService);
    const tron = app.get(TronService);

    const enabled = config.get<boolean>('sweep.enabled');
    const usdtDestination = (
      config.get<string>('sweep.usdtDestinationAddress') ??
      config.get<string>('sweep.adminWalletAddress')
    )?.trim();
    const gasKey = (
      config.get<string>('sweep.gasFeePrivateKey') ??
      config.get<string>('sweep.adminWalletPrivateKey')
    )?.trim();
    const gasAddress = (
      config.get<string>('sweep.gasFeeWalletAddress') ?? 'TPzEBy29h7hECMymPNRx9mGSqehf6THS2k'
    ).trim();
    const node = config.get<string>('sweep.tronFullNode');
    const contract = config.get<string>('cryptoApis.usdtContract');

    console.log('--- Sweep configuration ---');
    console.log(`SWEEP_ENABLED:            ${enabled}`);
    console.log(`COLLECTION_WALLET (USDT): ${usdtDestination || '(not set)'}`);
    console.log(`GAS_WALLET (TRX):         ${gasAddress || '(not set)'}`);
    console.log(`GAS_FEE_WALLET_PRIVATE_KEY: ${gasKey ? '(set)' : '(not set)'}`);
    console.log(`TRON_FULL_NODE:           ${node}`);
    console.log(`TRON_USDT_CONTRACT:       ${contract}`);

    if (!enabled) {
      console.log('\nSweep is disabled. Set SWEEP_ENABLED=true to activate.');
      return;
    }

    if (!usdtDestination || !gasKey) {
      console.error('\nCollection wallet address and gas fee private key are required.');
      process.exitCode = 1;
      return;
    }

    const [destUsdt, gasTrx] = await Promise.all([
      tron.getUsdtBalance(usdtDestination),
      tron.getTrxBalance(gasAddress),
    ]);
    console.log('\n--- Wallet balances ---');
    console.log(`Collection Vault (${usdtDestination}): USDT=${destUsdt}`);
    console.log(`Gas Dispenser Wallet (${gasAddress}): TRX=${gasTrx}`);

    const sampleAddresses = process.argv.slice(2);
    if (sampleAddresses.length > 0) {
      console.log('\n--- Sample deposit wallet balances ---');
      for (const address of sampleAddresses) {
        const trx = await tron.getTrxBalance(address);
        const usdt = await tron.getUsdtBalance(address);
        console.log(`${address}: TRX=${trx}, USDT=${usdt}`);
      }
    }

    console.log('\nConfiguration looks valid. Enable on testnet first, then fund admin TRX for gas.');
  } catch (err) {
    console.error('Verification failed:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run();
