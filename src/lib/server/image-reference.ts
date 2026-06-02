export const IMAGE_REF_ERROR_CODES = {
  INVALID_FORMAT: 'IMAGE_REF_INVALID_FORMAT',
  EMPTY_NAME: 'IMAGE_REF_EMPTY_NAME',
  INVALID_TAG: 'IMAGE_REF_INVALID_TAG',
  INVALID_NAMESPACE: 'IMAGE_REF_INVALID_NAMESPACE'
} as const;

export type ImageRefErrorCode = (typeof IMAGE_REF_ERROR_CODES)[keyof typeof IMAGE_REF_ERROR_CODES];

export type ImageRefErrorJson = {
  code: ImageRefErrorCode;
  message: string;
};

export class ImageRefError extends Error {
  code: ImageRefErrorCode;

  constructor(code: ImageRefErrorCode, message: string) {
    super(message);
    this.name = 'ImageRefError';
    this.code = code;
  }

  toJSON(): ImageRefErrorJson {
    return { code: this.code, message: this.message };
  }
}

export type NormalizedImageRef = {
  raw: string;
  registry?: string;
  namespace: string;
  repository: string;
  tag: string;
  fullName: string;
  fullNameWithTag: string;
};

const OFFICIAL_NAMESPACE = 'library';
const DEFAULT_TAG = 'latest';

// Docker Hub reference grammar (simplified, no digest support):
// [registry/]namespace/repo[:tag]  or  [registry/]repo[:tag] (official)
// We do not support private registry auth in v1.

function isValidNamePart(part: string): boolean {
  if (!part || part.length === 0) return false;
  // Allow lowercase letters, digits, underscores, periods, and hyphens
  // Must not start/end with separator
  return /^[a-z0-9]+([._-]?[a-z0-9]+)*$/.test(part);
}

function isValidTag(tag: string): boolean {
  if (!tag || tag.length === 0) return false;
  if (tag.length > 128) return false;
  // Tag can contain lowercase letters, digits, underscores, periods, hyphens, and slashes
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag);
}

export function parseImageReference(input: string): NormalizedImageRef {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ImageRefError(IMAGE_REF_ERROR_CODES.EMPTY_NAME, 'Image reference is empty.');
  }

  // Reject references that look like URLs or contain spaces
  if (/\s/.test(trimmed)) {
    throw new ImageRefError(
      IMAGE_REF_ERROR_CODES.INVALID_FORMAT,
      'Image reference cannot contain whitespace.'
    );
  }

  let working = trimmed;
  let registry: string | undefined;

  // Detect registry prefix (contains :port or is a known registry host)
  const firstSlash = working.indexOf('/');
  if (firstSlash > 0) {
    const firstPart = working.slice(0, firstSlash);
    if (firstPart.includes('.') || firstPart.includes(':') || firstPart === 'localhost') {
      registry = firstPart;
      working = working.slice(firstSlash + 1);
    }
  }

  // Split tag
  let tag = DEFAULT_TAG;
  const tagColon = working.lastIndexOf(':');
  if (tagColon > 0) {
    const possibleTag = working.slice(tagColon + 1);
    // Ensure the colon is not part of a port in the registry (already stripped)
    // and not the first character
    if (possibleTag.indexOf('/') === -1) {
      tag = possibleTag;
      working = working.slice(0, tagColon);
    }
  }

  if (!isValidTag(tag)) {
    throw new ImageRefError(IMAGE_REF_ERROR_CODES.INVALID_TAG, `Invalid tag "${tag}".`);
  }

  // Split namespace and repository
  const parts = working.split('/');
  let namespace: string;
  let repository: string;

  if (parts.length === 1) {
    namespace = OFFICIAL_NAMESPACE;
    repository = parts[0];
  } else if (parts.length === 2) {
    namespace = parts[0];
    repository = parts[1];
  } else {
    // For deeper paths, treat all but last as namespace path
    repository = parts[parts.length - 1];
    namespace = parts.slice(0, -1).join('/');
  }

  if (!isValidNamePart(repository)) {
    throw new ImageRefError(
      IMAGE_REF_ERROR_CODES.INVALID_FORMAT,
      `Invalid repository name "${repository}".`
    );
  }

  if (!namespace || !isValidNamePart(namespace)) {
    throw new ImageRefError(
      IMAGE_REF_ERROR_CODES.INVALID_NAMESPACE,
      `Invalid namespace "${namespace}".`
    );
  }

  const fullName = `${namespace}/${repository}`;
  const fullNameWithTag = `${fullName}:${tag}`;

  return {
    raw: trimmed,
    registry,
    namespace,
    repository,
    tag,
    fullName,
    fullNameWithTag
  };
}

export function normalizeImageReference(input: string): string {
  const parsed = parseImageReference(input);
  return parsed.fullNameWithTag;
}

export function isValidImageReference(input: string): boolean {
  try {
    parseImageReference(input);
    return true;
  } catch {
    return false;
  }
}

export function imageRefToDockerHubParts(input: string): {
  namespace: string;
  repository: string;
  tag: string;
} {
  const parsed = parseImageReference(input);
  return {
    namespace: parsed.namespace,
    repository: parsed.repository,
    tag: parsed.tag
  };
}
