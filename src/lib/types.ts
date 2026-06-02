export type SmolVmMachine = {
  name: string;
  status?: string;
  state?: string;
  [key: string]: unknown;
};

export type ViewMode = 'cards' | 'table';

export type ToastVariant = 'success' | 'error' | 'info';

export type ConfirmVariant = 'danger' | 'warning';

export type TabId = 'overview' | 'config' | 'logs' | 'terminal' | 'metrics';

export type VmStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error' | 'unknown';

export type ImagePickerSelection = {
  namespace: string;
  repository: string;
  tag: string;
  fullName: string;
};

export type VmPortMapping = {
  host: number;
  guest: number;
};

export type VmVolumeMount = {
  host: string;
  guest: string;
  readOnly?: boolean;
};

export type VmConfig = {
  name: string;
  image?: string;
  tag?: string;
  from?: string;
  cpus?: number;
  memory?: number;
  storage?: number;
  overlay?: number;
  net?: boolean;
  gpu?: boolean;
  gpuVram?: number;
  allowHosts?: string[];
  allowCidrs?: string[];
  ports?: VmPortMapping[];
  volumes?: VmVolumeMount[];
  env?: Record<string, string>;
  workdir?: string;
  init?: string[];
  sshAgent?: boolean;
  entrypoint?: string;
  cmd?: string;
};

export type ConfigValidationError = {
  field: string;
  message: string;
};

export type ConfigDiff = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  requiresRecreate: boolean;
};

export type VmFormMode = 'create' | 'edit' | 'copy' | 'recreate';
