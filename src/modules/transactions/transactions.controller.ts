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
import { TransactionsService } from './transactions.service';

const MAX_LIMIT = 200;

@Controller('user/transactions')
export class TransactionsController {
  constructor(private readonly tx: TransactionsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  list(
    @CurrentUser() current: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    return this.tx.listForUser(current.id, safeLimit);
  }
}
