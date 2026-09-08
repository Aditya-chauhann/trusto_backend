import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Types } from 'mongoose';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { DepositsService } from '../deposits/deposits.service';
import { WalletsService } from '../wallets/wallets.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import { SmartLiquidationService } from '../withdrawals/smart-liquidation.service';
import { USDT_INR_RATE, round2 } from '../withdrawals/constants';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('user')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly depositsService: DepositsService,
    private readonly walletsService: WalletsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly smartLiquidation: SmartLiquidationService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async getCurrentUser(@CurrentUser() currentUser: { id: string }) {
    let dashboard = await this.usersService.getDashboard(currentUser.id);

    // Auto-assign wallet if user is verified but has no wallet address yet
    if (
      (!dashboard.walletAddress ||
        dashboard.walletAddress.startsWith('UNVERIFIED_')) &&
      (dashboard.twoFactorVerified ||
        dashboard.profile.emailVerified ||
        dashboard.profile.phoneVerified)
    ) {
      try {
        const user = await this.usersService.findById(currentUser.id);
        if (
          user &&
          (!user.walletAddress || user.walletAddress.startsWith('UNVERIFIED_'))
        ) {
          const wallet = await this.walletsService.claimUnused(
            user._id as Types.ObjectId,
          );
          user.walletAddress = wallet.address;
          await user.save();
          dashboard.walletAddress = wallet.address;
        }
      } catch (err) {
        // Pool may be temporarily empty
      }
    }

    const totalDeposits =
      await this.depositsService.sumUserVisibleDepositsFor(currentUser.id);
    const locked = await this.withdrawalsService.sumLockedFor(currentUser.id);
    const available = round2(Math.max(totalDeposits - locked, 0));

    // While Smart auto-liquidation is on, the whole available balance is offered
    // to the pool. Surface it as "reserved" so the UI can show the held balance
    // (labelled Reserved) and disable the manual withdraw button.
    const smartEnabled = Boolean(dashboard.smartUpiSelectionEnabled);
    const reserved = smartEnabled
      ? await this.smartLiquidation.sumHeldReservationUsd(currentUser.id)
      : 0;

    let qrImageDataUrl: string | null = null;
    if (dashboard.walletAddress) {
      const wallet = await this.walletsService.findByAddressWithQr(
        dashboard.walletAddress,
      );
      if (wallet?.qrImage && wallet.qrImage.length > 0) {
        const mime = wallet.qrImageMimeType ?? 'image/png';
        qrImageDataUrl = `data:${mime};base64,${wallet.qrImage.toString('base64')}`;
      }
    }

    return {
      ...dashboard,
      qrImageDataUrl,
      balances: {
        ...dashboard.balances,
        totalDeposits: totalDeposits.toFixed(2),
        totalWithdrawals: locked.toFixed(2),
        available: available.toFixed(2),
        reserved: reserved.toFixed(2),
        smartEnabled,
        exchangeRate: USDT_INR_RATE,
      },
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch()
  updateProfile(
    @CurrentUser() current: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(current.id, dto);
  }
}
