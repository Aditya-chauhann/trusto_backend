import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminOnly } from '../../common/decorators/superadmin-only.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { AlertsService } from './alerts.service';
import {
  AlertResolution,
  AlertSeverity,
  AlertType,
} from './schemas/alert.schema';

class ResolveAlertDto {
  @IsEnum(AlertResolution, {
    message:
      'action must be either "cleared" (false alarm — unfreezes user and restores bank account) or "confirmed" (real fraud — keeps user frozen)',
  })
  action: AlertResolution;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
// 
function parseType(value?: string): AlertType | undefined {
  if (value === undefined) return undefined;
  if (
    Object.values(AlertType).includes(value as AlertType)
  ) {
    return value as AlertType;
  }
  throw new BadRequestException(`Invalid alert type "${value}"`);
}

function parseSeverity(value?: string): AlertSeverity | undefined {
  if (value === undefined) return undefined;
  if (Object.values(AlertSeverity).includes(value as AlertSeverity)) {
    return value as AlertSeverity;
  }
  throw new BadRequestException(`Invalid severity "${value}"`);
}

function parseBool(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`Expected true|false, got "${value}"`);
}

class GrantStaffTempPasswordDto {
  @IsString()
  @MaxLength(100)
  temporaryPassword: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@Controller('admin/alerts')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@SuperAdminOnly()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) { }

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
  ) {
    return this.alerts.list({
      page,
      limit,
      type: parseType(type),
      severity: parseSeverity(severity),
      resolved: parseBool(resolved),
    });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.alerts.getById(id);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAlertDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.alerts.resolve(id, current.id, dto.action, dto.notes);
  }

  @Post(':id/grant-temp-password')
  grantTempPassword(
    @Param('id') id: string,
    @Body() dto: GrantStaffTempPasswordDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.alerts.grantStaffTempPassword(
      id,
      current.id,
      dto.temporaryPassword,
      dto.notes,
    );
  }
}
