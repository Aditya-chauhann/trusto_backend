import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CryptoApisWebhookGuard } from './cryptoapis-webhook.guard';
import { CryptoApisWebhookMapper } from './cryptoapis-webhook.mapper';

@Controller('webhooks/cryptoapis')
export class CryptoApisWebhookController {
  constructor(private readonly mapper: CryptoApisWebhookMapper) {}

  @UseGuards(CryptoApisWebhookGuard)
  @Post('tron')
  async onTronEvent(@Body() body: Record<string, unknown>) {
    await this.mapper.handle(body);
    return { ok: true };
  }
}
