export const PERMISSIONS = {
  Dashboard: 'dashboard',
  Users: 'users',
  Tags: 'tags',
  Deposits: 'deposits',
  Withdrawals: 'withdrawals',
  Wallets: 'wallets',
  Roles: 'roles',
  Settings: 'settings',
  Tickets: 'tickets',
  Export: 'export',
  ExportUsers: 'export_users',
  ExportDeposits: 'export_deposits',
  ExportWithdrawals: 'export_withdrawals',
  Distribution: 'distribution',
  Announcements: 'announcements',
  IpActivities: 'ip_activities',
} as const;

export const SUPERADMIN_PERMISSION = '*';

export interface PermissionCatalogItem {
  key: string;
  label: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  {
    key: PERMISSIONS.Dashboard,
    label: 'Dashboard',
    description: 'Overview & KPIs',
  },
  {
    key: PERMISSIONS.Users,
    label: 'Users',
    description: 'User list, KYC, tags',
  },
  {
    key: PERMISSIONS.Tags,
    label: 'Tags',
    description: 'Manage user tier tags',
  },
  {
    key: PERMISSIONS.Deposits,
    label: 'Deposits',
    description: 'Approve & monitor deposits',
  },
  {
    key: PERMISSIONS.Withdrawals,
    label: 'Withdrawals',
    description: 'Review & process withdrawals',
  },
  {
    key: PERMISSIONS.Wallets,
    label: 'Wallets',
    description: 'Platform wallet addresses',
  },
  {
    key: PERMISSIONS.Roles,
    label: 'Roles',
    description: 'Manage staff roles and accounts',
  },
  {
    key: PERMISSIONS.Settings,
    label: 'Settings',
    description: 'Fees, rates, system controls',
  },
  {
    key: PERMISSIONS.Tickets,
    label: 'Tickets',
    description: 'View and resolve support tickets',
  },
  {
    key: PERMISSIONS.Export,
    label: 'Export',
    description: 'Export data from admin lists',
  },
  {
    key: PERMISSIONS.ExportUsers,
    label: 'Export Users',
    description: 'Export users list data to CSV',
  },
  {
    key: PERMISSIONS.ExportDeposits,
    label: 'Export Deposits',
    description: 'Export deposits list data to CSV',
  },
  {
    key: PERMISSIONS.ExportWithdrawals,
    label: 'Export Withdrawals',
    description: 'Export withdrawals list data to CSV',
  },
  {
    key: PERMISSIONS.Distribution,
    label: 'Distribution',
    description: 'Access distribution portal & referral network',
  },
  {
    key: PERMISSIONS.Announcements,
    label: 'Notification Centre',
    description: 'Manage broadcast announcements and system notification controls',
  },
  {
    key: PERMISSIONS.IpActivities,
    label: 'IP Activities',
    description: 'Monitor user login/transaction IP addresses',
  },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);

const ALL_PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

export function isValidPermissionKey(key: string): boolean {
  return ALL_PERMISSION_KEY_SET.has(key);
}
