import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpiAccountsService } from './upi-accounts.service';
import { SmartLiquidationService } from './smart-liquidation.service';
import { CreateUpiAccountDto } from './dto/create-upi-account.dto';
import { SetUpiActiveDto } from './dto/set-upi-active.dto';
import { SetSmartUpiSelectionDto } from './dto/set-smart-upi-selection.dto';
import { SMART_TOGGLE_MIN_USDT } from './constants';

@Controller('user/upi-accounts')
@UseGuards(AuthGuard('jwt'))
export class UpiAccountsController {
  constructor(
    private readonly upiAccounts: UpiAccountsService,
    private readonly smartLiquidation: SmartLiquidationService,
  ) {}

  @Post()
  create(
    @CurrentUser() current: { id: string },
    @Body() dto: CreateUpiAccountDto,
  ) {
    return this.upiAccounts.create(current.id, dto);
  }

  @Get()
  list(@CurrentUser() current: { id: string }) {
    return this.upiAccounts.listForUser(current.id);
  }

  // UPI IDs that other users added which are duplicates of one this user owns,
  // awaiting this user's (the original owner's) approval.
  @Get('pending-approvals')
  pendingApprovals(@CurrentUser() current: { id: string }) {
    return this.upiAccounts.listPendingApprovalsForOwner(current.id);
  }

  @Post('pending-approvals/:id/approve')
  approve(@CurrentUser() current: { id: string }, @Param('id') id: string) {
    return this.upiAccounts.approveSharedUpi(current.id, id);
  }

  @Post('pending-approvals/:id/reject')
  reject(@CurrentUser() current: { id: string }, @Param('id') id: string) {
    return this.upiAccounts.rejectSharedUpi(current.id, id);
  }

  // Per-user Smart UPI Selection toggle. Declared before the `:id` routes so
  // the literal path isn't captured as an :id param.
  @Get('smart-selection')
  getSmartSelection(@CurrentUser() current: { id: string }) {
    return this.upiAccounts.getSmartSelection(current.id);
  }

  @Patch('smart-selection')
  async setSmartSelection(
    @CurrentUser() current: { id: string },
    @Body() dto: SetSmartUpiSelectionDto,
  ) {
    if (dto.enabled) {
      const minUsdt = await this.smartLiquidation.getSmartToggleMinUsdt();
      const balance =
        await this.smartLiquidation.getAvailableBalanceWithoutReservation(
          current.id,
        );
      if (balance < minUsdt) {
        throw new BadRequestException(
          `Minimum balance of ${minUsdt} USDT is required to enable Smart UPI Selection. Your available balance is ${balance.toFixed(2)} USDT.`,
        );
      }
    }

    const res = await this.upiAccounts.setSmartSelection(current.id, dto);
    // Drive auto-liquidation: arm the balance on enable, release it on disable.
    if (dto.enabled) {
      await this.smartLiquidation.arm(current.id);
    } else {
      await this.smartLiquidation.disarm(current.id);
    }
    return res;
  }

  @Patch(':id/default')
  setDefault(@CurrentUser() current: { id: string }, @Param('id') id: string) {
    return this.upiAccounts.setDefault(current.id, id);
  }

  @Patch(':id/active')
  async setActive(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
    @Body() dto: SetUpiActiveDto,
  ) {
    const res = await this.upiAccounts.setActive(current.id, id, dto);
    // Deactivating a UPI must not leave a Smart reservation pointing at it.
    if (dto.isActive === false) {
      await this.smartLiquidation.handleUpiRemoved(current.id, res.upiId);
    }
    return res;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ): Promise<void> {
    const removedUpiId = await this.upiAccounts.remove(current.id, id);
    // Cancel any Smart reservation still armed on the deleted UPI (pulls the
    // Telegram announcement) and re-arm on a remaining UPI if one is available.
    await this.smartLiquidation.handleUpiRemoved(current.id, removedUpiId);
  }
}
