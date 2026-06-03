import { buildManifest, entity, field, auth, query, action, policy } from '@pylonsync/sdk';

const User = entity('User', {
  email: field.string().unique(),
  name: field.string().optional(),
  passwordHash: field.string().serverOnly(),
  isAdmin: field.bool()
});

const AuditEvent = entity('AuditEvent', {
  eventType: field.string(),
  actorUserId: field.string().optional(),
  action: field.string().optional(),
  details: field.string().optional(),
  ipAddress: field.string().optional(),
  createdAt: field.datetime()
});

const ManagerSetting = entity('ManagerSetting', {
  key: field.string().unique(),
  valueJson: field.string(),
  updatedAt: field.datetime()
});

const SavedVmConfig = entity('SavedVmConfig', {
  name: field.string(),
  machineName: field.string(),
  configJson: field.string(),
  toml: field.string(),
  createdAt: field.datetime(),
  updatedAt: field.datetime()
});

const TomlSnapshot = entity('TomlSnapshot', {
  machineName: field.string(),
  toml: field.string(),
  reason: field.string().optional(),
  createdAt: field.datetime()
});

const MetricsSample = entity('MetricsSample', {
  machineName: field.string().optional(),
  cpu: field.float(),
  memoryMb: field.float(),
  diskGb: field.float(),
  networkRxBytes: field.int(),
  networkTxBytes: field.int(),
  sampledAt: field.datetime()
});

const UiPreference = entity('UiPreference', {
  userId: field.string(),
  key: field.string(),
  valueJson: field.string(),
  updatedAt: field.datetime()
});

const managerQueries = [
  query('getSetting', { input: [{ name: 'key', type: 'string' }] }),
  query('listSettings'),
  query('getSavedVmConfig', { input: [{ name: 'id', type: 'id(SavedVmConfig)' }] }),
  query('listSavedVmConfigs'),
  query('listTomlSnapshots', { input: [{ name: 'machineName', type: 'string', optional: true }] }),
  query('listMetricsSamples', {
    input: [
      { name: 'machineName', type: 'string', optional: true },
      { name: 'limit', type: 'int', optional: true }
    ]
  }),
  query('listAuditEvents', { input: [{ name: 'limit', type: 'int', optional: true }] }),
  query('getUiPreference', {
    input: [
      { name: 'userId', type: 'string' },
      { name: 'key', type: 'string' }
    ]
  }),
  query('listUiPreferences', { input: [{ name: 'userId', type: 'string' }] })
];

const managerMutations = [
  action('setSetting', {
    input: [
      { name: 'key', type: 'string' },
      { name: 'valueJson', type: 'string' }
    ]
  }),
  action('createSavedVmConfig', {
    input: [
      { name: 'name', type: 'string' },
      { name: 'machineName', type: 'string' },
      { name: 'configJson', type: 'string' },
      { name: 'toml', type: 'string' }
    ]
  }),
  action('updateSavedVmConfig', {
    input: [
      { name: 'id', type: 'id(SavedVmConfig)' },
      { name: 'name', type: 'string', optional: true },
      { name: 'machineName', type: 'string', optional: true },
      { name: 'configJson', type: 'string', optional: true },
      { name: 'toml', type: 'string', optional: true }
    ]
  }),
  action('deleteSavedVmConfig', { input: [{ name: 'id', type: 'id(SavedVmConfig)' }] }),
  action('createTomlSnapshot', {
    input: [
      { name: 'machineName', type: 'string' },
      { name: 'toml', type: 'string' },
      { name: 'reason', type: 'string', optional: true }
    ]
  }),
  action('insertMetricsSample', {
    input: [
      { name: 'machineName', type: 'string', optional: true },
      { name: 'cpu', type: 'float' },
      { name: 'memoryMb', type: 'float' },
      { name: 'diskGb', type: 'float' },
      { name: 'networkRxBytes', type: 'int' },
      { name: 'networkTxBytes', type: 'int' }
    ]
  }),
  action('pruneMetricsSamples', {
    input: [
      { name: 'beforeDate', type: 'datetime', optional: true },
      { name: 'maxCount', type: 'int', optional: true }
    ]
  }),
  action('insertAuditEvent', {
    input: [
      { name: 'eventType', type: 'string' },
      { name: 'actorUserId', type: 'string', optional: true },
      { name: 'action', type: 'string', optional: true },
      { name: 'details', type: 'string', optional: true },
      { name: 'ipAddress', type: 'string', optional: true }
    ]
  }),
  action('pruneAuditEvents', {
    input: [
      { name: 'beforeDate', type: 'datetime', optional: true },
      { name: 'maxCount', type: 'int', optional: true }
    ]
  }),
  action('setUiPreference', {
    input: [
      { name: 'userId', type: 'string' },
      { name: 'key', type: 'string' },
      { name: 'valueJson', type: 'string' }
    ]
  })
];

const managerPolicies = [
  policy({
    entity: 'ManagerSetting',
    allowRead: "auth.hasRole('admin')",
    allowWrite: "auth.hasRole('admin')"
  }),
  policy({
    entity: 'SavedVmConfig',
    allowRead: "auth.hasRole('admin')",
    allowWrite: "auth.hasRole('admin')"
  }),
  policy({
    entity: 'TomlSnapshot',
    allowRead: "auth.hasRole('admin')",
    allowWrite: "auth.hasRole('admin')"
  }),
  policy({
    entity: 'MetricsSample',
    allowRead: "auth.hasRole('admin')",
    allowWrite: "auth.hasRole('admin')"
  }),
  policy({
    entity: 'AuditEvent',
    allowRead: "auth.hasRole('admin')",
    allowInsert: "auth.hasRole('admin')",
    allowUpdate: "auth.hasRole('admin')",
    allowDelete: "auth.hasRole('admin')"
  }),
  policy({
    entity: 'UiPreference',
    allowRead: "auth.userId == data.userId || auth.hasRole('admin')",
    allowWrite: "auth.userId == data.userId || auth.hasRole('admin')"
  })
];

export default buildManifest({
  name: 'smolvm-manager',
  version: '0.0.1',
  entities: [
    User,
    AuditEvent,
    ManagerSetting,
    SavedVmConfig,
    TomlSnapshot,
    MetricsSample,
    UiPreference
  ],
  routes: [],
  queries: managerQueries,
  actions: managerMutations,
  policies: managerPolicies,
  auth: auth({
    user: {
      entity: 'User',
      expose: ['id', 'email', 'name', 'isAdmin'],
      hide: ['passwordHash'],
      adminField: 'isAdmin'
    },
    session: {
      expiresIn: 60 * 60 * 24 // 24 hours
    },
    trustedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000']
  })
});
