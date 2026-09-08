import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { WalletsService } from './wallets.service';
import { WalletShard1, WalletShard1Schema } from './schemas/wallet-shard1.schema';
import { WalletShard2, WalletShard2Schema } from './schemas/wallet-shard2.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Wallet.name, schema: WalletSchema }]),
    MongooseModule.forFeature(
      [{ name: WalletShard1.name, schema: WalletShard1Schema }],
      'shard1Connection',
    ),
    MongooseModule.forFeature(
      [{ name: WalletShard2.name, schema: WalletShard2Schema }],
      'shard2Connection',
    ),
  ],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
