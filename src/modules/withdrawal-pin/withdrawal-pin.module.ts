import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { WithdrawalPinService } from './withdrawal-pin.service';
import { WithdrawalPinController } from './withdrawal-pin.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    TwoFactorModule,
  ],
  controllers: [WithdrawalPinController],
  providers: [WithdrawalPinService],
  exports: [WithdrawalPinService],
})
export class WithdrawalPinModule {}
