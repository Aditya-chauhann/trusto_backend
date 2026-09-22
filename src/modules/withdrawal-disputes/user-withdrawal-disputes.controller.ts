import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import {
  DisputeUpload,
  WithdrawalDisputesService,
} from './withdrawal-disputes.service';
import { CreateWithdrawalDisputeDto } from './dto/create-withdrawal-dispute.dto';
import { DailyLogger } from '../../common/daily-logger';

@Controller('user/withdrawal-disputes')
@UseGuards(AuthGuard('jwt'))
export class UserWithdrawalDisputesController {
  constructor(private readonly disputes: WithdrawalDisputesService) {}

  // Raise a dispute from the post-approval modal. Sent as multipart/form-data:
  // the fields (withdrawalId, reason, description) plus the `bankStatement` PDF.
  @Post()
  @UseInterceptors(
    FileInterceptor('bankStatement', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  create(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: CreateWithdrawalDisputeDto,
    @UploadedFile() bankStatement: DisputeUpload,
    @Req() req: any,
  ) {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || '127.0.0.1';
    DailyLogger.log(`[SECURITY] File uploaded: userId=${current.id}, filename=${bankStatement?.originalname}, mimetype=${bankStatement?.mimetype}, size=${bankStatement?.size} bytes, ip=${ip}`, 'UserWithdrawalDisputesController');
    return this.disputes.createForUser(current.id, dto, bankStatement, ip);
  }

  @Get()
  list(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.disputes.listForUser(current.id, limit);
  }

  @Get(':id')
  getOne(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Param('id') id: string,
  ) {
    return this.disputes.getOwnedByUser(current.id, id);
  }
}
