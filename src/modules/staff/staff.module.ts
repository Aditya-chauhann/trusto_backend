import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { StaffRole, StaffRoleSchema } from './schemas/staff-role.schema';
import { StaffUser, StaffUserSchema } from './schemas/staff-user.schema';
import { StaffPinOtp, StaffPinOtpSchema } from './schemas/staff-pin-otp.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffPinController } from './staff-pin.controller';
import { StaffPinService } from './staff-pin.service';
import {
  StaffRolesController,
  PermissionsCatalogController,
} from './staff-roles.controller';
import { StaffRolesService } from './staff-roles.service';
import { StaffUsersController } from './staff-users.controller';
import { StaffUsersService } from './staff-users.service';
import { PublicAgentsController } from './public-agents.controller';

import { AlertsModule } from '../alerts/alerts.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { IpBlockModule } from '../ip-block/ip-block.module';

@Module({
  imports: [
    PassportModule,
    AlertsModule,
    CaptchaModule,
    IpBlockModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn') ?? '60m',
        },
      }),
    }),
    TwoFactorModule,
    MongooseModule.forFeature([
      { name: StaffRole.name, schema: StaffRoleSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
      { name: StaffPinOtp.name, schema: StaffPinOtpSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    StaffAuthController,
    StaffPinController,
    StaffRolesController,
    PermissionsCatalogController,
    StaffUsersController,
    PublicAgentsController,
  ],
  providers: [
    StaffAuthService,
    StaffPinService,
    StaffRolesService,
    StaffUsersService,
  ],
  exports: [MongooseModule, StaffAuthService, StaffPinService],
})
export class StaffModule {}
