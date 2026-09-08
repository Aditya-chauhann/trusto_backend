import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { PERMISSIONS } from '../staff/permissions.constants';
import { PricingHistoryScope } from './schemas/pricing-history.schema';
import { PricingService } from './pricing.service';
import { UpdateGlobalPricingDto } from './dto/update-global-pricing.dto';
import { UpdateUserPricingDto } from './dto/update-user-pricing.dto';

function actor(p: AuthenticatedRequestUser) {
  return { id: p.id, type: p.type };
}

@Controller('admin/pricing')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Settings)
export class AdminPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  getGlobal() {
    return this.pricing.getGlobal();
  }

  @Patch()
  updateGlobal(
    @Body() dto: UpdateGlobalPricingDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.pricing.updateGlobal(dto, actor(current));
  }

  @Get('overrides')
  listOverrides(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.pricing.listOverrides(page, limit);
  }

  @Get('history')
  listHistory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('scope') scope?: string,
    @Query('userId') userId?: string,
  ) {
    return this.pricing.listHistory({
      page,
      limit,
      scope: parseScope(scope),
      userId,
    });
  }
}

@Controller('admin/users/:userId/pricing')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Settings)
export class AdminUserPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  get(@Param('userId') userId: string) {
    return this.pricing.getUserPricing(userId);
  }

  @Put()
  set(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPricingDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.pricing.setUserPricing(userId, dto, actor(current));
  }

  @Delete()
  clear(
    @Param('userId') userId: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.pricing.clearUserPricing(userId, actor(current));
  }

  @Get('history')
  history(
    @Param('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.pricing.listHistory({
      page,
      limit,
      scope: PricingHistoryScope.User,
      userId,
    });
  }
}

function parseScope(value?: string): PricingHistoryScope | undefined {
  if (value === undefined) return undefined;
  if (value === PricingHistoryScope.Global || value === PricingHistoryScope.User) {
    return value;
  }
  throw new BadRequestException(`Invalid scope "${value}"`);
}

@Controller('pricing')
@UseGuards(AuthGuard('jwt'))
export class UserPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('me')
  me(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.pricing.getEffectiveForUserWithFlag(current.id);
  }
}

@Controller('public/pricing')
export class PublicPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  getGlobal() {
    return this.pricing.getGlobal();
  }
}
