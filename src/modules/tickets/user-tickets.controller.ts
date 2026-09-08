import {
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

@Controller('user/tickets')
@UseGuards(AuthGuard('jwt'))
export class UserTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: CreateTicketDto,
  ) {
    return this.tickets.createForUser(current.id, dto);
  }

  @Get()
  list(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.tickets.listForUser(current.id, limit);
  }

  @Get(':id')
  getOne(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Param('id') id: string,
  ) {
    return this.tickets.getOwnedByUser(current.id, id);
  }
}
