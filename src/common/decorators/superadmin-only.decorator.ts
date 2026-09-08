import { SetMetadata } from '@nestjs/common';

export const SUPERADMIN_ONLY_KEY = 'superadmin_only';
export const SuperAdminOnly = () => SetMetadata(SUPERADMIN_ONLY_KEY, true);
