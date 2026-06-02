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
