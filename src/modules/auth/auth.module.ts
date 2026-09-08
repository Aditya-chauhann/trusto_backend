import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
// ADDED: needed for AuthService's direct @InjectModel(User.name) in forgotPassword/resetPassword
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StaffModule } from '../staff/staff.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CryptoApisModule } from '../cryptoapis/cryptoapis.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { IpBlockModule } from '../ip-block/ip-block.module';


@Module({
  imports: [
    UsersModule,
    WalletsModule,
    StaffModule,
    TwoFactorModule,
    CryptoApisModule,
    CaptchaModule,
    IpBlockModule,
    PassportModule,
    // ADDED: registers Model<UserDocument> in this module's DI scope so
    // AuthService can @InjectModel(User.name) directly (UsersModule and
    // TwoFactorModule both register this schema too, but neither exports
    // the model provider — only their services — so it must be registered
    // here as well).
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
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
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}