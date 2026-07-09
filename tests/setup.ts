import { vi } from 'vitest';

// LocalStorage mock
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem(key: string) {
    return localStorageStore[key] || null;
  },
  setItem(key: string, value: string) {
    localStorageStore[key] = value.toString();
  },
  clear() {
    for (const key in localStorageStore) {
      delete localStorageStore[key];
    }
  },
  removeItem(key: string) {
    delete localStorageStore[key];
  }
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
});

// SessionStorage mock
const sessionStorageStore: Record<string, string> = {};
const sessionStorageMock = {
  getItem(key: string) {
    return sessionStorageStore[key] || null;
  },
  setItem(key: string, value: string) {
    sessionStorageStore[key] = value.toString();
  },
  clear() {
    for (const key in sessionStorageStore) {
      delete sessionStorageStore[key];
    }
  },
  removeItem(key: string) {
    delete sessionStorageStore[key];
  }
};

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true
});

// Window mock
Object.defineProperty(global, 'window', {
  value: {
    dispatchEvent: vi.fn(),
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
  },
  writable: true
});
