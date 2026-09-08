import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { StaffPinService } from './staff-pin.service';
import {
  ChangeStaffPinDto,
  ConfirmStaffPinResetDto,
  SetStaffPinDto,
  VerifyStaffPinDto,
} from './dto/staff-pin.dto';

/**
 * Super admin console login PIN.
 *
 * These endpoints deliberately sit behind plain JWT auth (no PermissionsGuard)
 * so a super admin whose console is still locked can reach them — every other
 * admin route is blocked by PermissionsGuard until `POST verify` succeeds.
 *
 * Both flavours of super admin are accepted: staff accounts with
 * `isSuperAdmin`, and customer accounts with `role: superadmin` (which
 * `/admin/auth/login` also signs in).
 */
@UseGuards(AuthGuard('jwt'))
@Controller('admin/auth/pin')
export class StaffPinController {
  constructor(private readonly pinService: StaffPinService) {}

  @Get('status')
  status(@CurrentUser() principal: AuthenticatedRequestUser) {
    this.assertSuperAdmin(principal);
    return this.pinService.status(
      principal.id,
      principal.type,
      principal.pinVerified === true,
    );
  }

  @Post('set')
  set(
    @CurrentUser() principal: AuthenticatedRequestUser,
    @Body() dto: SetStaffPinDto,
  ) {
    this.assertSuperAdmin(principal);
    return this.pinService.setPin(principal.id, principal.type, dto);
  }

  @Post('verify')
  verify(
    @CurrentUser() principal: AuthenticatedRequestUser,
    @Body() dto: VerifyStaffPinDto,
  ) {
    this.assertSuperAdmin(principal);
    return this.pinService.verifyPin(principal.id, principal.type, dto);
  }

  @Post('change')
  change(
    @CurrentUser() principal: AuthenticatedRequestUser,
    @Body() dto: ChangeStaffPinDto,
  ) {
    this.assertSuperAdmin(principal);
    if (principal.pinVerified !== true) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'PIN_REQUIRED',
        message: 'Unlock the console with your current PIN first.',
      });
    }
    return this.pinService.changePin(principal.id, principal.type, dto);
  }

  @Post('reset/request')
  requestReset(@CurrentUser() principal: AuthenticatedRequestUser) {
    this.assertSuperAdmin(principal);
    return this.pinService.requestReset(principal.id, principal.type);
  }

  @Post('reset/confirm')
  confirmReset(
    @CurrentUser() principal: AuthenticatedRequestUser,
    @Body() dto: ConfirmStaffPinResetDto,
  ) {
    this.assertSuperAdmin(principal);
    return this.pinService.confirmReset(principal.id, principal.type, dto);
  }

  /** Manual re-lock — used on sign-out and by the client idle timer. */
  @Post('lock')
  lock(@CurrentUser() principal: AuthenticatedRequestUser) {
    this.assertSuperAdmin(principal);
    return this.pinService.lock(principal.id, principal.type);
  }

  private assertSuperAdmin(principal: AuthenticatedRequestUser): void {
    if (!principal.isSuperAdmin) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'SUPERADMIN_REQUIRED',
        message: 'The login PIN applies to super admin accounts only.',
      });
    }
  }
}
