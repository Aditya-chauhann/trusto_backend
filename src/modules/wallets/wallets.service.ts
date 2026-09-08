import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Wallet,
  WalletDocument,
  WalletStatus,
} from './schemas/wallet.schema';
import { WalletShard1Document, WalletShard1 } from './schemas/wallet-shard1.schema';
import { WalletShard2Document, WalletShard2 } from './schemas/wallet-shard2.schema';
import { ConfigService } from '@nestjs/config';
import { CryptoUtil } from './utils/crypto.util';

export interface WalletSeedEntry {
  address: string;
  qrImage?: Buffer;
  qrImageMimeType?: string;
}

@Injectable()
export class WalletsService {
  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletShard1.name, 'shard1Connection')
    private readonly shard1Model: Model<WalletShard1Document>,
    @InjectModel(WalletShard2.name, 'shard2Connection')
    private readonly shard2Model: Model<WalletShard2Document>,
    private readonly configService: ConfigService,
  ) {}

  async claimUnused(userId: Types.ObjectId): Promise<WalletDocument> {
    const wallet = await this.walletModel.findOneAndUpdate(
      { status: WalletStatus.Unused },
      {
        $set: {
          status: WalletStatus.Assigned,
          assignedTo: userId,
          assignedAt: new Date(),
        },
      },
      { new: true, sort: { createdAt: 1 } },
    );

    if (!wallet) {
      throw new ServiceUnavailableException(
        'No wallet addresses available. Please top up the wallet pool.',
      );
    }

    return wallet;
  }

  async release(address: string): Promise<void> {
    await this.walletModel.updateOne(
      { address },
      {
        $set: {
          status: WalletStatus.Unused,
          assignedTo: null,
          assignedAt: null,
        },
      },
    );
  }

  findByAddressWithQr(address: string): Promise<WalletDocument | null> {
    return this.walletModel
      .findOne({ address })
      .select('+qrImage qrImageMimeType address')
      .exec();
  }

  findByAddress(address: string): Promise<WalletDocument | null> {
    return this.walletModel.findOne({ address }).exec();
  }

  async seedAddresses(
    entries: WalletSeedEntry[],
  ): Promise<{ inserted: number; skipped: number; qrUpdated: number }> {
    let inserted = 0;
    let skipped = 0;
    let qrUpdated = 0;

    for (const entry of entries) {
      const insertRes = await this.walletModel.updateOne(
        { address: entry.address },
        {
          $setOnInsert: {
            address: entry.address,
            status: WalletStatus.Unused,
            assignedTo: null,
            assignedAt: null,
          },
        },
        { upsert: true },
      );

      if (insertRes.upsertedCount && insertRes.upsertedCount > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }

      if (entry.qrImage && entry.qrImage.length > 0) {
        const existing = await this.walletModel
          .findOne({ address: entry.address })
          .select('+qrImage');
        const incoming = entry.qrImage;
        const same =
          existing?.qrImage instanceof Buffer &&
          existing.qrImage.length === incoming.length &&
          existing.qrImage.equals(incoming);
        if (!same) {
          await this.walletModel.updateOne(
            { address: entry.address },
            {
              $set: {
                qrImage: incoming,
                qrImageMimeType: entry.qrImageMimeType ?? 'image/png',
              },
            },
          );
          qrUpdated += 1;
        }
      }
    }

    return { inserted, skipped, qrUpdated };
  }

  async storePrivateKey(
    walletId: Types.ObjectId,
    address: string,
    privateKey: string,
  ): Promise<void> {
    const encryptionKey = this.configService.get<string>('walletEncryptionKey');
    if (!encryptionKey) {
      throw new Error('walletEncryptionKey is not configured');
    }

    // 1. Split the private key into two shards
    const { shard1, shard2 } = CryptoUtil.splitKey(privateKey);

    // 2. Encrypt both shards using AES-256-GCM
    const encrypted1 = CryptoUtil.encrypt(shard1, encryptionKey);
    const encrypted2 = CryptoUtil.encrypt(shard2, encryptionKey);

    // 3. Store in the two different shard databases
    await Promise.all([
      this.shard1Model.updateOne(
        { walletId },
        {
          $set: {
            walletAddress: address,
            encryptedShard: encrypted1.encrypted,
            iv: encrypted1.iv,
            authTag: encrypted1.authTag,
          },
        },
        { upsert: true },
      ),
      this.shard2Model.updateOne(
        { walletId },
        {
          $set: {
            walletAddress: address,
            encryptedShard: encrypted2.encrypted,
            iv: encrypted2.iv,
            authTag: encrypted2.authTag,
          },
        },
        { upsert: true },
      ),
    ]);
  }

  async reconstructPrivateKey(walletId: Types.ObjectId): Promise<string> {
    const encryptionKey = this.configService.get<string>('walletEncryptionKey');
    if (!encryptionKey) {
      throw new Error('walletEncryptionKey is not configured');
    }

    // 1. Fetch both encrypted shards from their respective DBs
    const [shard1Doc, shard2Doc] = await Promise.all([
      this.shard1Model.findOne({ walletId }).exec(),
      this.shard2Model.findOne({ walletId }).exec(),
    ]);

    if (!shard1Doc || !shard2Doc) {
      throw new ServiceUnavailableException('One or both wallet shards are missing');
    }

    // 2. Decrypt both shards
    const decryptedShard1 = CryptoUtil.decrypt(
      shard1Doc.encryptedShard,
      shard1Doc.iv,
      shard1Doc.authTag,
      encryptionKey,
    );
    const decryptedShard2 = CryptoUtil.decrypt(
      shard2Doc.encryptedShard,
      shard2Doc.iv,
      shard2Doc.authTag,
      encryptionKey,
    );

    // 3. Reconstruct the private key
    return CryptoUtil.reconstructKey(decryptedShard1, decryptedShard2);
  }
}
