import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { Response } from 'express';
import { SystemControlsService } from '../system-controls/system-controls.service';

export interface HealthResponse {
  /** 'ok' when everything is serving, 'degraded' when a dependency is down. */
  status: 'ok' | 'degraded';
  db: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceEta: string | null;
  uptime: number;
  timestamp: string;
}

/**
 * Public, unauthenticated liveness/readiness probe. Polled by every open
 * browser tab, so it must stay cheap: no writes, and the only read is the
 * single-document system-controls lookup.
 *
 * Note this endpoint can never report "server down" — a dead process answers
 * nothing at all. The client treats a failed request as down; this endpoint
 * exists to distinguish a *planned* maintenance window from an outage, and to
 * surface "process alive but Mongo disconnected".
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly controls: SystemControlsService,
  ) {}

  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponse> {
    // readyState is a cached flag on the driver — no round trip to Mongo.
    const db = this.connection.readyState === 1;

    let maintenance = {
      maintenanceMode: false,
      maintenanceMessage: '',
      maintenanceEta: null as string | null,
    };
    if (db) {
      try {
        maintenance = await this.controls.getMaintenanceState();
      } catch {
        // A controls read failure must not turn the probe itself into a 500 —
        // report degraded and let the client fall back to its own defaults.
        res.status(HttpStatus.SERVICE_UNAVAILABLE);
        return this.body(false, maintenance);
      }
    }

    if (!db) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return this.body(db, maintenance);
  }

  private body(
    db: boolean,
    maintenance: {
      maintenanceMode: boolean;
      maintenanceMessage: string;
      maintenanceEta: string | null;
    },
  ): HealthResponse {
    return {
      status: db ? 'ok' : 'degraded',
      db,
      ...maintenance,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
