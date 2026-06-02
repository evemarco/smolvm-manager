import { buildManifest } from '@pylonsync/sdk';

const manifest = buildManifest({
  name: 'smolvm-manager',
  version: '0.0.1',
  entities: [],
  queries: [],
  actions: [],
  policies: [],
  routes: []
});

console.log(JSON.stringify(manifest, null, 2));
