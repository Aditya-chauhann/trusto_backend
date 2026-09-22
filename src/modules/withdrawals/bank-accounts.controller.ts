import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@Controller('user/bank-accounts')
@UseGuards(AuthGuard('jwt'))
export class BankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get('check-duplicate')
  checkDuplicate(
    @CurrentUser() current: { id: string },
    @Query('accountNumber') accountNumber: string,
  ) {
    return this.bankAccounts.checkDuplicate(current.id, accountNumber);
  }

  @Post()
  create(
    @CurrentUser() current: { id: string },
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.bankAccounts.create(current.id, dto);
  }

  @Get()
  list(@CurrentUser() current: { id: string }) {
    return this.bankAccounts.listForUser(current.id);
  }

  // Accounts that other users added which are duplicates of an account this
  // user owns, awaiting this user's (the original owner's) approval.
  @Get('pending-approvals')
  pendingApprovals(@CurrentUser() current: { id: string }) {
    return this.bankAccounts.listPendingApprovalsForOwner(current.id);
  }

  @Post('pending-approvals/:id/approve')
  approve(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ) {
    return this.bankAccounts.approveSharedAccount(current.id, id);
  }

  @Post('pending-approvals/:id/reject')
  reject(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ) {
    return this.bankAccounts.rejectSharedAccount(current.id, id);
  }

  @Patch(':id/default')
  setDefault(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ) {
    return this.bankAccounts.setDefault(current.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.bankAccounts.update(current.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ): Promise<void> {
    await this.bankAccounts.remove(current.id, id);
  }
}
