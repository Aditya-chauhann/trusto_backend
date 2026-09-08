import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

// Room name for a given end user. Every socket the user opens joins this room,
// so we can push to all their devices/tabs at once.
const userRoom = (userId: string) => `user:${userId}`;

/**
 * Live push channel to end users. Clients connect with their JWT in the socket
 * handshake (auth.token, ?token=, or Authorization header). Other services call
 * `emitToUser()` to push events — e.g. "your UPI payout was initiated, open the
 * dispute modal".
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn('Socket without token — disconnecting');
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret') ?? 'change-me',
      });
      const type = payload.type ?? 'user';
      // Only end users get a personal room (disputes are user-facing).
      if (type === 'user') {
        void client.join(userRoom(payload.sub));
      }
      client.data.userId = payload.sub;
      client.data.type = type;
    } catch {
      this.logger.warn('Socket with invalid token — disconnecting');
      client.disconnect(true);
    }
  }

  // Push an event to every socket belonging to a user.
  emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return this.strip(fromAuth);

    const fromQuery = client.handshake.query?.token;
    if (typeof fromQuery === 'string' && fromQuery) return this.strip(fromQuery);

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header) return this.strip(header);

    return null;
  }

  private strip(raw: string): string {
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  }
}
