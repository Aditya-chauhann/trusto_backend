import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IpActivity, IpActivitySchema } from './schemas/ip-activity.schema';
import { IpActivityService } from './ip-activity.service';
import { AdminIpActivityController } from './admin-ip-activity.controller';
import { User, UserSchema } from '../users/schemas/user.schema';
import { StaffUser, StaffUserSchema } from '../staff/schemas/staff-user.schema';
import { BlockedIp, BlockedIpSchema } from '../ip-block/schemas/blocked-ip.schema';
import { Alert, AlertSchema } from '../alerts/schemas/alert.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IpActivity.name, schema: IpActivitySchema },
      { name: User.name, schema: UserSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
      { name: BlockedIp.name, schema: BlockedIpSchema },
      { name: Alert.name, schema: AlertSchema },
    ]),
  ],
  controllers: [AdminIpActivityController],
  providers: [IpActivityService],
  exports: [IpActivityService],
})
export class IpActivityModule {}
