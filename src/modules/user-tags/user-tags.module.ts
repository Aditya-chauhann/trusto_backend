import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Deposit, DepositSchema } from '../deposits/schemas/deposit.schema';
import {
  Withdrawal,
  WithdrawalSchema,
} from '../withdrawals/schemas/withdrawal.schema';
import { UserTag, UserTagSchema } from './schemas/user-tag.schema';
import {
  UserTagHistory,
  UserTagHistorySchema,
} from './schemas/user-tag-history.schema';
import { UserTagsService } from './user-tags.service';
import { UserTagAssignmentsService } from './user-tag-assignments.service';
import { TagEvaluatorService } from './tag-evaluator.service';
import { AdminUserTagsController } from './admin-user-tags.controller';
import { AdminUserTagAssignmentsController } from './admin-user-tag-assignments.controller';
import { UserTagsController } from './user-tags.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserTag.name, schema: UserTagSchema },
      { name: UserTagHistory.name, schema: UserTagHistorySchema },
      { name: User.name, schema: UserSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ]),
  ],
  controllers: [
    AdminUserTagsController,
    AdminUserTagAssignmentsController,
    UserTagsController,
  ],
  providers: [
    UserTagsService,
    UserTagAssignmentsService,
    TagEvaluatorService,
  ],
  exports: [
    UserTagsService,
    UserTagAssignmentsService,
    TagEvaluatorService,
  ],
})
export class UserTagsModule {}
