import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { StaffUser, StaffUserSchema } from '../staff/schemas/staff-user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DepositsModule } from '../deposits/deposits.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
    ]),
    DepositsModule,
    WalletsModule,
    WithdrawalsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
