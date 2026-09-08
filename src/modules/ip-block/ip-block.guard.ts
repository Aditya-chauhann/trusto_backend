import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IpBlockService } from './ip-block.service';

@Injectable()
export class IpBlockGuard implements CanActivate {
  constructor(private readonly ipBlockService: IpBlockService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = this.ipBlockService.getClientIp(req);
    const endpoint = req.url || req.path;

    await this.ipBlockService.checkIp(ip, endpoint);
    return true;
  }
}
