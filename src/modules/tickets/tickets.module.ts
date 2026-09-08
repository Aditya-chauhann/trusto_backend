import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { StaffModule } from '../staff/staff.module';
import { TicketsService } from './tickets.service';
import { UserTicketsController } from './user-tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
    StaffModule,
    NotificationsModule,
  ],
  controllers: [UserTicketsController, AdminTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
