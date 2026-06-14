const isAbsolutePath = (value) => value.startsWith('/');

const splitSegments = (value) =>
  value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');

export const normalizePath = (value) => {
  const input = value.replace(/\\/g, '/');
  const absolute = isAbsolutePath(input);
  const segments = [];

  for (const segment of input.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!absolute) {
        segments.push('..');
      }
      continue;
    }

    segments.push(segment);
  }

  const normalized = `${absolute ? '/' : ''}${segments.join('/')}`;
  return normalized || (absolute ? '/' : '.');
};

export const joinPaths = (...parts) => normalizePath(parts.filter(Boolean).join('/'));

export const dirname = (value) => {
  const normalized = normalizePath(value);

  if (normalized === '/' || normalized === '.') {
    return normalized;
  }

  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash <= 0) {
    return normalized.startsWith('/') ? '/' : '.';
  }

  return normalized.slice(0, lastSlash) || '/';
};

export const resolvePath = (base, value) => {
  if (!value || value === '.') {
    return normalizePath(base);
  }

  if (isAbsolutePath(value)) {
    return normalizePath(value);
  }

  return normalizePath(joinPaths(base, value));
};

export const ensureWithinRoot = (root, value) => {
  const normalizedRoot = normalizePath(root);
  const normalizedValue = normalizePath(value);

  if (normalizedRoot === '/') {
    return normalizedValue;
  }

  if (
    normalizedValue !== normalizedRoot &&
    !normalizedValue.startsWith(`${normalizedRoot}/`)
  ) {
    throw new Error(`path ${value} escapes root ${root}`);
  }

  return normalizedValue;
};

export const relativeToRoot = (root, value) => {
  const normalizedRoot = normalizePath(root);
  const normalizedValue = ensureWithinRoot(normalizedRoot, value);

  if (normalizedRoot === '/') {
    return normalizedValue.replace(/^\/+/, '');
  }

  if (normalizedValue === normalizedRoot) {
    return '';
  }

  return normalizedValue.slice(normalizedRoot.length + 1);
};

export const fileUrlToPath = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  if (!value.startsWith('file://')) {
    return value;
  }

  const withoutProtocol = value.slice('file://'.length);
  return decodeURI(withoutProtocol);
};

export const pathToFileUrl = (value) => {
  const normalized = normalizePath(value);
  return `file://${encodeURI(normalized)}`;
};

export const isBareSpecifier = (value) =>
  !value.startsWith('.') &&
  !value.startsWith('/') &&
  !value.startsWith('file://') &&
  !value.startsWith('node:');

export const parsePackageSpecifier = (value) => {
  const segments = splitSegments(value);

  if (segments.length === 0) {
    throw new Error(`invalid package specifier ${value}`);
  }

  if (value.startsWith('@')) {
    if (segments.length < 2) {
      throw new Error(`invalid scoped package specifier ${value}`);
    }

    return {
      packageName: `${segments[0]}/${segments[1]}`,
      subpath: segments.slice(2).join('/'),
    };
  }

  return {
    packageName: segments[0],
    subpath: segments.slice(1).join('/'),
  };
};
