import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DepositsService } from './deposits.service';

const MAX_LIMIT = 200;

@Controller('user')
export class UserDepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('deposits')
  list(
    @CurrentUser() current: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    return this.deposits.listForUser(current.id, safeLimit);
  }
}
