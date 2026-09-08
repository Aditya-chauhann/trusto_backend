import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { ReportsService, ReportPayload } from './reports.service';
import { buildFilename, streamXlsx } from './xlsx.helper';

@Controller('admin/reports')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(['registered-customers', 'customers'])
  async registeredCustomers(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tagId') tagId?: string,
    @Query('blocked') blocked?: string,
    @Query('agentId') agentId?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.registeredCustomers({
      from,
      to,
      tagId,
      blocked,
      agentId,
    });
    await this.send(res, payload, preview);
  }

  @Get('deposits')
  async deposits(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.deposits({ from, to, userId });
    await this.send(res, payload, preview);
  }

  @Get('withdrawals')
  async withdrawals(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('processedBy') processedBy?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.withdrawals({
      from,
      to,
      status,
      userId,
      processedBy,
    });
    await this.send(res, payload, preview);
  }

  @Get('customer-ledger')
  async customerLedger(
    @Res() res: Response,
    @Query('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.customerLedger({ userId, from, to });
    await this.send(res, payload, preview);
  }

  @Get('customer-balances')
  async customerBalances(
    @Res() res: Response,
    @Query('tagId') tagId?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.customerBalances({ tagId });
    await this.send(res, payload, preview);
  }

  @Get(['users-by-tag', 'tier-users'])
  async usersByTag(
    @Res() res: Response,
    @Query('tags') tags?: string,
    @Query('tag') tag?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.usersByTag({ tags: tags || tag || '' });
    await this.send(res, payload, preview);
  }

  @Get('active-customers')
  async activeCustomers(
    @Res() res: Response,
    @Query('days') days?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.activeCustomers({ days });
    await this.send(res, payload, preview);
  }

  @Get('inactive-customers')
  async inactiveCustomers(
    @Res() res: Response,
    @Query('period') period?: string,
    @Query('count') count?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.inactiveCustomers({ period, count });
    await this.send(res, payload, preview);
  }

  @Get('pending-withdrawals')
  async pendingWithdrawals(
    @Res() res: Response,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.pendingWithdrawals();
    await this.send(res, payload, preview);
  }

  @Get('tickets')
  async tickets(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('team') team?: string,
    @Query('resolutionStatus') resolutionStatus?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('preview') preview?: string,
  ) {
    const payload = await this.reports.tickets({
      from,
      to,
      team,
      resolutionStatus,
      assigneeId,
    });
    await this.send(res, payload, preview);
  }

  private async send(
    res: Response,
    payload: ReportPayload,
    preview?: string,
  ): Promise<void> {
    if (preview === 'true' || preview === '1') {
      res.json(payload);
      return;
    }
    await streamXlsx(
      res,
      buildFilename(payload.filename),
      payload.sheetName,
      payload.columns,
      payload.rows,
    );
  }
}
