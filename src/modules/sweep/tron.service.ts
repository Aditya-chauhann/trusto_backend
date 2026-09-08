import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TronWeb } = require('tronweb');

const USDT_DECIMALS = 6;
const TRX_DECIMALS = 6;

const TRC20_USDT_ABI = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

@Injectable()
export class TronService {
  private readonly logger = new Logger(TronService.name);

  constructor(private readonly config: ConfigService) {}

  private getUsdtContract(): string {
    return (
      this.config.get<string>('cryptoApis.usdtContract') ??
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    );
  }

  private createTronWeb(privateKey?: string): InstanceType<typeof TronWeb> {
    const fullHost =
      this.config.get<string>('sweep.tronFullNode') ??
      'https://api.trongrid.io';
    const apiKey = this.config.get<string>('sweep.tronApiKey') ?? '';
    const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined;

    return new TronWeb({
      fullHost,
      headers,
      ...(privateKey ? { privateKey: this.normalizePrivateKey(privateKey) } : {}),
    });
  }

  normalizePrivateKey(key: string): string {
    const trimmed = key.trim();
    return trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  }

  getAddressFromPrivateKey(privateKey: string): string {
    const tronWeb = this.createTronWeb(privateKey);
    return tronWeb.address.fromPrivateKey(this.normalizePrivateKey(privateKey));
  }

  private fromTokenUnits(raw: bigint | string | number, decimals: number): number {
    const value = BigInt(raw);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = value % divisor;
    return Number(whole) + Number(frac) / Number(divisor);
  }

  private toTokenUnits(amount: number, decimals: number): string {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be a positive number');
    }
    const scaled = Math.round(amount * 10 ** decimals);
    return String(scaled);
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 5, baseDelayMs = 2000): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit =
          msg.includes('429') ||
          msg.includes('rate') ||
          msg.includes('403') ||
          msg.includes('Too Many Requests');
        if (attempt === maxRetries || !isRateLimit) {
          throw err;
        }
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `[TronService] TronGrid rate limited (429). Retrying attempt ${attempt}/${maxRetries} in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return fn();
  }

  async getTrxBalance(address: string): Promise<number> {
    return this.withRetry(async () => {
      const tronWeb = this.createTronWeb();
      const sun = await tronWeb.trx.getBalance(address);
      return this.fromTokenUnits(BigInt(sun), TRX_DECIMALS);
    });
  }

  async getUsdtBalance(address: string): Promise<number> {
    return this.withRetry(async () => {
      const tronWeb = this.createTronWeb();
      tronWeb.setAddress(address);
      const contract = await tronWeb.contract(TRC20_USDT_ABI, this.getUsdtContract());
      const raw = await contract.balanceOf(address).call({ from: address });
      let value: bigint;
      if (Array.isArray(raw)) {
        value = BigInt(raw[0]);
      } else if (typeof raw === 'object' && raw !== null) {
        if ('_hex' in raw) {
          value = BigInt((raw as { _hex: string })._hex);
        } else if ('toString' in raw && typeof (raw as { toString: () => string }).toString === 'function') {
          value = BigInt((raw as { toString: () => string }).toString());
        } else {
          value = BigInt(raw as number);
        }
      } else {
        value = BigInt(raw);
      }
      return this.fromTokenUnits(value, USDT_DECIMALS);
    });
  }

  async sendTrx(
    fromPrivateKey: string,
    toAddress: string,
    amountTrx: number,
  ): Promise<string> {
    return this.withRetry(async () => {
      const tronWeb = this.createTronWeb(fromPrivateKey);
      const fromAddress = tronWeb.address.fromPrivateKey(
        this.normalizePrivateKey(fromPrivateKey),
      );
      const amountSun = this.toTokenUnits(amountTrx, TRX_DECIMALS);
      const tx = await tronWeb.trx.sendTransaction(toAddress, Number(amountSun));
      if (!tx?.result) {
        throw new Error(
          `TRX transfer failed: ${JSON.stringify(tx?.code ?? tx?.message ?? tx)}`,
        );
      }
      const txHash = tx.txid ?? tx.transaction?.txID;
      if (!txHash) {
        throw new Error('TRX transfer succeeded but no tx hash returned');
      }
      this.logger.log(
        `TRX sent ${amountTrx} from ${fromAddress} to ${toAddress}: ${txHash}`,
      );
      return txHash;
    });
  }

  async sendUsdt(
    fromPrivateKey: string,
    toAddress: string,
    amountUsdt: number,
  ): Promise<string> {
    return this.withRetry(async () => {
      const tronWeb = this.createTronWeb(fromPrivateKey);
      const fromAddress = tronWeb.address.fromPrivateKey(
        this.normalizePrivateKey(fromPrivateKey),
      );
      const contract = await tronWeb.contract(TRC20_USDT_ABI, this.getUsdtContract());
      const amountUnits = this.toTokenUnits(amountUsdt, USDT_DECIMALS);
      const txHash = await contract
        .transfer(toAddress, amountUnits)
        .send({ feeLimit: 100_000_000 });
      if (!txHash) {
        throw new Error('USDT transfer failed: no tx hash returned');
      }
      this.logger.log(
        `USDT sent ${amountUsdt} from ${fromAddress} to ${toAddress}: ${txHash}`,
      );
      return txHash;
    });
  }

  async waitForConfirmation(
    txHash: string,
    timeoutMs?: number,
  ): Promise<void> {
    const tronWeb = this.createTronWeb();
    const deadline =
      Date.now() +
      (timeoutMs ?? this.config.get<number>('sweep.txConfirmTimeoutMs') ?? 120_000);
    const pollMs = 4_000;

    while (Date.now() < deadline) {
      try {
        const info = await this.withRetry(async () => {
          return await tronWeb.trx.getTransactionInfo(txHash);
        });
        if (info?.id && info.blockNumber) {
          if (info.receipt?.result === 'SUCCESS') {
            return;
          }
          if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
            throw new Error(
              `Transaction ${txHash} failed on-chain: ${info.receipt.result}`,
            );
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('failed on-chain')) {
          throw err;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(`Transaction ${txHash} not confirmed within timeout`);
  }
}
