import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SUPERADMIN_ONLY_KEY } from '../decorators/superadmin-only.decorator';
import { SUPERADMIN_PERMISSION } from '../../modules/staff/permissions.constants';
import { DailyLogger } from '../daily-logger';

export interface AuthenticatedPrincipal {
  id: string;
  type: 'user' | 'staff';
  permissions: string[];
  isSuperAdmin: boolean;
  mustChangePassword?: boolean;
  pinSet?: boolean;
  pinVerified?: boolean;
  email?: string;
  username?: string;
  name?: string;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(ctx: ExecutionContext): boolean {
    const superAdminOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      SUPERADMIN_ONLY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    const hasMetadata = Boolean(superAdminOnly) || (required ?? []).length > 0;

    const request = ctx.switchToHttp().getRequest<{
      user?: AuthenticatedPrincipal;
      method?: string;
      url?: string;
      originalUrl?: string;
    }>();
    const principal = request.user;

    // Account-level blocks run before (and independently of) permission
    // metadata, so an endpoint without @RequirePermissions is still gated.
    if (principal?.type === 'staff' && principal.mustChangePassword === true) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before continuing.',
      });
    }

    // Applies to both flavours of super admin: staff accounts with
    // `isSuperAdmin`, and customer accounts with `role: superadmin` — both can
    // sign in at /admin/auth/login.
    if (principal?.isSuperAdmin && principal.pinVerified !== true) {
      throw new ForbiddenException(
        principal.pinSet === false
          ? {
            statusCode: 403,
            errorCode: 'PIN_SETUP_REQUIRED',
            message:
              'Generate your 6-digit login PIN before using the admin console.',
          }
          : {
            statusCode: 403,
            errorCode: 'PIN_REQUIRED',
            message:
              'Enter your 6-digit login PIN to unlock the admin console.',
          },
      );
    }

    if (!hasMetadata) {
      return true;
    }

    if (!principal) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'NOT_AUTHENTICATED',
        message: 'Authentication required',
      });
    }

    if (principal.isSuperAdmin) {
      return true;
    }

    const className = ctx.getClass()?.name || 'Controller';
    const handlerName = ctx.getHandler()?.name || 'handler';

    if (superAdminOnly) {
      const userEmail = principal.email || principal.username || principal.name || 'Unknown User';
      const userType = principal.type ? ` (${principal.type})` : '';
      const method = request.method || 'UNKNOWN';
      const path = request.originalUrl || request.url || 'UNKNOWN';

      DailyLogger.security(
        `User: ${userEmail}${userType}\nUser ID: ${principal.id}\nAction: ${method} ${path}\nRequired: SuperAdmin Only\nReason: This action is restricted to the super admin.`,
        `${className}.${handlerName}`,
      );

      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'SUPERADMIN_REQUIRED',
        message: 'This action is restricted to the super admin.',
      });
    }

    const granted = new Set(principal.permissions);
    if (granted.has(SUPERADMIN_PERMISSION)) {
      return true;
    }

    const missing = (required ?? []).filter((perm) => !granted.has(perm));
    if (missing.length > 0) {
      const userEmail = principal.email || principal.username || principal.name || 'Unknown User';
      const userType = principal.type ? ` (${principal.type})` : '';
      const method = request.method || 'UNKNOWN';
      const path = request.originalUrl || request.url || 'UNKNOWN';

      DailyLogger.security(
        `User: ${userEmail}${userType}\nUser ID: ${principal.id}\nAction: ${method} ${path}\nMissing Permission: ${missing.join(', ')}\nReason: You do not have permission to perform this action.`,
        `${className}.${handlerName}`,
      );

      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'MISSING_PERMISSION',
        message: 'You do not have permission to perform this action.',
        missingPermissions: missing,
      });
    }

    return true;
  }
}
