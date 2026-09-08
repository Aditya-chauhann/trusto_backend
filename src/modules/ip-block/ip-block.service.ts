import { Injectable, HttpStatus, HttpException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockedIp, BlockedIpDocument } from './schemas/blocked-ip.schema';
import { IpAttempt, IpAttemptDocument } from './schemas/ip-attempt.schema';
import { DailyLogger } from '../../common/daily-logger';

const WINDOW_MS = 60000; // 1 minute window
const MAX_ATTEMPTS = 5; // max 5 requests/minute
const BLOCK_DURATION_MS = 3600000; // 60 minutes block duration

@Injectable()
export class IpBlockService implements OnModuleInit {
  public static cachedPublicIp: string | null = null;
  private static publicIpFetchedAt = 0;

  constructor(
    @InjectModel(BlockedIp.name) private readonly blockedModel: Model<BlockedIpDocument>,
    @InjectModel(IpAttempt.name) private readonly attemptModel: Model<IpAttemptDocument>,
  ) { }

  async onModuleInit() {
    void this.resolveServerPublicIp();
  }

  async resolveServerPublicIp(): Promise<string | null> {
    const now = Date.now();
    // Cache for 30 minutes
    if (IpBlockService.cachedPublicIp && now - IpBlockService.publicIpFetchedAt < 30 * 60 * 1000) {
      return IpBlockService.cachedPublicIp;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as { ip?: string };
        if (data?.ip && typeof data.ip === 'string') {
          IpBlockService.cachedPublicIp = data.ip.trim();
          IpBlockService.publicIpFetchedAt = now;
          return data.ip.trim();
        }
      }
    } catch {
      // Fallback to api64
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await fetch('https://api64.ipify.org?format=json', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = (await res.json()) as { ip?: string };
          if (data?.ip && typeof data.ip === 'string') {
            IpBlockService.cachedPublicIp = data.ip.trim();
            IpBlockService.publicIpFetchedAt = now;
            return data.ip.trim();
          }
        }
      } catch {}
    }
    return null;
  }

  async checkIp(ip: string, endpoint: string): Promise<void> {
    // 1. Check if IP is currently blocked
    const block = await this.blockedModel.findOne({ ip });
    if (block) {
      if (block.blockedUntil > new Date()) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            errorCode: 'IP_BLOCKED',
            message: `Too many requests from this IP. Blocked. Try again after ${block.blockedUntil.toLocaleTimeString()}`,
            blockedUntil: block.blockedUntil.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      } else {
        // Block has expired but TTL index hasn't run yet
        await this.blockedModel.deleteOne({ ip });
      }
    }

    // 2. Record this request
    await this.attemptModel.create({ ip, endpoint });

    // 3. Count attempts in window
    const windowStart = new Date(Date.now() - WINDOW_MS);
    const attemptCount = await this.attemptModel.countDocuments({
      ip,
      createdAt: { $gte: windowStart },
    });

    if (attemptCount > MAX_ATTEMPTS) {
      const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
      const reason = `Rate limit exceeded on auth endpoints (${attemptCount} attempts in 1 min)`;

      await this.blockedModel.updateOne(
        { ip },
        { blockedUntil, reason },
        { upsert: true },
      );

      DailyLogger.security(
        `Blocked IP ${ip} until ${blockedUntil.toISOString()} due to excessive hits (${attemptCount} attempts on ${endpoint})`,
        'IpBlockService',
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'IP_BLOCKED',
          message: `Too many requests. Your IP has been blocked for 15 minutes.`,
          blockedUntil: blockedUntil.toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  getClientIp(req: any): string {
    const cfConnectingIp = req.headers?.['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
      let ip = cfConnectingIp.trim();
      if (ip.startsWith('::ffff:')) ip = ip.substring(7);
      if (ip === '::1') ip = '127.0.0.1';
      return ip;
    }

    // Client-supplied network IP header from trusted web application
    const xClientNetworkIp =
      req.headers?.['x-client-network-ip'] ||
      req.headers?.['x-client-ip'] ||
      req.headers?.['x-network-ip'];
    if (typeof xClientNetworkIp === 'string' && xClientNetworkIp.trim()) {
      let ip = xClientNetworkIp.trim();
      if (ip.startsWith('::ffff:')) ip = ip.substring(7);
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') {
        return ip;
      }
    }

    const xRealIp = req.headers?.['x-real-ip'];
    if (typeof xRealIp === 'string' && xRealIp.trim()) {
      let ip = xRealIp.trim();
      if (ip.startsWith('::ffff:')) ip = ip.substring(7);
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') {
        return ip;
      }
    }

    const xForwardedFor = req.headers?.['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
      const parts = xForwardedFor.split(',');
      for (const part of parts) {
        let clientIp = part.trim();
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7);
        if (clientIp === '::1') clientIp = '127.0.0.1';
        if (clientIp && clientIp !== '127.0.0.1' && clientIp !== 'localhost') {
          return clientIp;
        }
      }
    }

    let ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    if (typeof ip === 'string') {
      if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
      }
      if (ip === '::1') {
        ip = '127.0.0.1';
      }
    } else {
      ip = '127.0.0.1';
    }

    // If still local/loopback and we have a resolved public network IP, use it
    if ((ip === '127.0.0.1' || ip === 'localhost') && IpBlockService.cachedPublicIp) {
      return IpBlockService.cachedPublicIp;
    }

    return ip;
  }
}

