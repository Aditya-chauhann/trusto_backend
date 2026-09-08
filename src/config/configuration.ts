export default () => {
  const parsedMinutes = parseInt(process.env.SESSION_EXPIRES_IN_MINUTES ?? '5', 10);
  const sessionMinutes = Number.isInteger(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : 5;
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? `${sessionMinutes}m`;

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/tronpay',
    mongodbUriShard1: process.env.MONGODB_URI_SHARD_1 ?? 'mongodb://localhost:27017/tronpay_shard1',
    mongodbUriShard2: process.env.MONGODB_URI_SHARD_2 ?? 'mongodb://localhost:27017/tronpay_shard2',
    walletEncryptionKey: process.env.WALLET_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 32-byte hex for dev
    jwt: {
      secret: process.env.JWT_SECRET ?? 'change-me',
      expiresIn: jwtExpiresIn,
      sessionExpiresInMinutes: sessionMinutes,
      loginChallengeExpiresIn: process.env.JWT_LOGIN_CHALLENGE_EXPIRES_IN ?? '5m',
    },
    superAdminPin: {
      /** Minutes of inactivity after which a verified PIN session auto-locks. */
      idleMinutes: parseInt(process.env.SUPERADMIN_PIN_IDLE_MINUTES ?? '15', 10),
    },
    walletSeedFile: process.env.WALLET_SEED_FILE ?? './data/wallets.js',
    depositIngestWsUrl: process.env.DEPOSIT_INGEST_WS_URL || undefined,
    payoutBridge: {
      // Base URL of the standalone payout-bridge service.
      baseUrl: process.env.PAYOUT_BRIDGE_URL || undefined,
      // Sent as `x-api-key` when registering a payout request (outbound).
      apiKey: process.env.PAYOUT_BRIDGE_API_KEY ?? '',
      // Shared secret used to verify the `x-signature` on the bridge's callback
      // (inbound). Must match CALLBACK_SIGNING_SECRET in the bridge.
      callbackSecret: process.env.PAYOUT_BRIDGE_CALLBACK_SECRET ?? '',
    },
    cryptoApis: {
      apiKey: process.env.CRYPTOAPIS_API_KEY ?? '',
      baseUrl: process.env.CRYPTOAPIS_BASE_URL ?? 'https://rest.cryptoapis.io',
      apiVersion: process.env.CRYPTOAPIS_API_VERSION ?? '2024-12-12',
      webhookUrl: process.env.CRYPTOAPIS_WEBHOOK_URL ?? '',
      webhookSecret: process.env.CRYPTOAPIS_WEBHOOK_SECRET ?? '',
      blockchain: 'tron',
      network: process.env.CRYPTOAPIS_NETWORK ?? 'mainnet',
      usdtContract:
        process.env.TRON_USDT_CONTRACT ??
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    },
    sweep: {
      enabled: process.env.SWEEP_ENABLED === 'true',
      usdtDestinationAddress: process.env.USDT_DESTINATION_ADDRESS ?? process.env.ADMIN_WALLET_ADDRESS ?? 'TNSsZwUT1Vnfkn5WaE1yAcS4DUAtqYSQ4y',
      gasFeeWalletAddress: process.env.GAS_FEE_WALLET_ADDRESS ?? 'TPzEBy29h7hECMymPNRx9mGSqehf6THS2k',
      gasFeePrivateKey: process.env.GAS_FEE_WALLET_PRIVATE_KEY ?? process.env.ADMIN_WALLET_PRIVATE_KEY ?? '',
      adminWalletAddress: process.env.ADMIN_WALLET_ADDRESS ?? 'TNSsZwUT1Vnfkn5WaE1yAcS4DUAtqYSQ4y',
      adminWalletPrivateKey: process.env.ADMIN_WALLET_PRIVATE_KEY ?? '',
      tronFullNode: process.env.TRON_FULL_NODE ?? 'https://api.trongrid.io',
      tronApiKey: process.env.TRON_API_KEY ?? '',
      minUsdt: parseFloat(process.env.SWEEP_MIN_USDT ?? '1'),
      trxFundAmount: parseFloat(process.env.SWEEP_TRX_FUND_AMOUNT ?? '20'),
      trxMinBalance: parseFloat(process.env.SWEEP_TRX_MIN_BALANCE ?? '5'),
      maxAttempts: parseInt(process.env.SWEEP_MAX_ATTEMPTS ?? '5', 10),
      jobLockTtlMs: parseInt(process.env.SWEEP_JOB_LOCK_TTL_MS ?? '600000', 10),
      workerBatchSize: parseInt(process.env.SWEEP_WORKER_BATCH_SIZE ?? '5', 10),
      txConfirmTimeoutMs: parseInt(
        process.env.SWEEP_TX_CONFIRM_TIMEOUT_MS ?? '120000',
        10,
      ),
    },
  };
};
