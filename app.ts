import { buildManifest, entity, field, auth } from '@pylonsync/sdk';

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
  queries: [],
  actions: [],
  policies: [],
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
