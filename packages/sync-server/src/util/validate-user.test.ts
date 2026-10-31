import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSession } from '#account-db';

import { TOKEN_EXPIRATION_NEVER, validateSession } from './validate-user';

// Stub: isolates the unit from the SQLite account database.
vi.mock('#account-db', () => ({
  getSession: vi.fn(),
}));

// validate-user imports the config at module load; validateSession does not
// use it, so a dummy keeps the test independent from config files.
vi.mock('#load-config', () => ({
  config: { get: vi.fn() },
}));

const getSessionMock = vi.mocked(getSession);

// Fixed clock: 2023-11-14T22:13:20.000Z, an exact second boundary.
const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;

type FakeRequest = {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

function makeRequest({ body, headers = {} }: FakeRequest = {}) {
  return { body, headers } as unknown as Request;
}

// Spy: records what the unit writes to the HTTP response.
function makeResponse() {
  const res = {
    status: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

function makeSession(expiresAt: number) {
  return {
    token: 'session-token',
    user_id: 'user-1',
    expires_at: expiresAt,
    auth_method: 'password',
  };
}

beforeEach(() => {
  getSessionMock.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateSession', () => {

  describe('white box: decision coverage', () => {
    it('[CB-01] reads the token from the header when the request has no body', () => {
      // Arrange
      const session = makeSession(TOKEN_EXPIRATION_NEVER);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({
        body: undefined,
        headers: { 'x-actual-token': 'header-token' },
      });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(getSessionMock).toHaveBeenCalledWith('header-token');
      expect(result).toBe(session);
    });

    it('[CB-02] uses the token from the body and does not look at the header', () => {
      // Arrange
      const session = makeSession(TOKEN_EXPIRATION_NEVER);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({
        body: { token: 'body-token' },
        headers: { 'x-actual-token': 'header-token' },
      });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(getSessionMock).toHaveBeenCalledWith('body-token');
      expect(result).toBe(session);
    });

    it('[CB-03] responds 401 token-not-found when no session matches the token', () => {
      // Arrange
      getSessionMock.mockReturnValue(undefined);
      const req = makeRequest({ body: { token: 'unknown-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({
        status: 'error',
        reason: 'unauthorized',
        details: 'token-not-found',
      });
    });
  });

  describe('white box: MC/DC on expires_at !== -1 && expires_at * 1000 <= now', () => {
    it('[CB-04] (A=T, B=T -> T) rejects a session that expired one second ago', () => {
      // Arrange
      getSessionMock.mockReturnValue(makeSession(NOW_S - 1));
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({
        status: 'error',
        reason: 'token-expired',
      });
    });

    it('[CB-05] (A=T, B=F -> F) accepts a session that expires one second from now', () => {
      // Arrange
      const session = makeSession(NOW_S + 1);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBe(session);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('[CB-06] (A=F, B=T -> F) accepts a session that never expires', () => {
      // Arrange: -1 * 1000 <= now, so B would be true; only A makes it pass.
      const session = makeSession(TOKEN_EXPIRATION_NEVER);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBe(session);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Part 2 - Black box complement: equivalence partitioning and boundary
  // value analysis, derived from the contract (token in body or
  // x-actual-token header, expires_at in Unix seconds, -1 = never).
  // ---------------------------------------------------------------------
  describe('black box: equivalence partitioning on the token', () => {
    it('[CP-01] responds 401 token-not-found when no token is sent at all', () => {
      // Arrange
      getSessionMock.mockReturnValue(undefined);
      const req = makeRequest({ body: {}, headers: {} });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(getSessionMock).toHaveBeenCalledWith(undefined);
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith({
        status: 'error',
        reason: 'unauthorized',
        details: 'token-not-found',
      });
    });

    it('[CP-02] falls back to the header when the body token is an empty string', () => {
      // Arrange
      const session = makeSession(TOKEN_EXPIRATION_NEVER);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({
        body: { token: '' },
        headers: { 'x-actual-token': 'header-token' },
      });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(getSessionMock).toHaveBeenCalledWith('header-token');
      expect(result).toBe(session);
    });

    it('[CP-03] does not fall back to a valid header when the body token is unknown', () => {
      // Arrange
      getSessionMock.mockImplementation(token =>
        token === 'header-token'
          ? makeSession(TOKEN_EXPIRATION_NEVER)
          : undefined,
      );
      const req = makeRequest({
        body: { token: 'unknown-token' },
        headers: { 'x-actual-token': 'header-token' },
      });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(getSessionMock).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('black box: boundary values on expires_at', () => {
    it('[CP-04] rejects a session at the exact instant it expires', () => {
      // Arrange: expires_at * 1000 === now, the "<=" boundary.
      getSessionMock.mockReturnValue(makeSession(NOW_S));
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBeNull();
      expect(res.send).toHaveBeenCalledWith({
        status: 'error',
        reason: 'token-expired',
      });
    });

    it('[CP-05] rejects a session whose expiry second has started but the clock is mid-second', () => {
      // Arrange: now = NOW_S + 0.999 s; expires_at = NOW_S is already past.
      vi.spyOn(Date, 'now').mockReturnValue(NOW_MS + 999);
      getSessionMock.mockReturnValue(makeSession(NOW_S));
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('[CP-06] accepts a session one millisecond before its expiry instant', () => {
      // Arrange: now = expires_at * 1000 - 1 ms.
      vi.spyOn(Date, 'now').mockReturnValue(NOW_MS - 1);
      const session = makeSession(NOW_S);
      getSessionMock.mockReturnValue(session);
      const req = makeRequest({ body: { token: 'session-token' } });
      const res = makeResponse();

      // Act
      const result = validateSession(req, res as unknown as Response);

      // Assert
      expect(result).toBe(session);
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each([
      { expiresAt: -2, label: 'just below the never-expires sentinel' },
      { expiresAt: 0, label: 'the Unix epoch' },
    ])(
      '[CP-07] rejects expires_at = $expiresAt ($label) as expired',
      ({ expiresAt }) => {
        // Arrange
        getSessionMock.mockReturnValue(makeSession(expiresAt));
        const req = makeRequest({ body: { token: 'session-token' } });
        const res = makeResponse();

        // Act
        const result = validateSession(req, res as unknown as Response);

        // Assert
        expect(result).toBeNull();
        expect(res.send).toHaveBeenCalledWith({
          status: 'error',
          reason: 'token-expired',
        });
      },
    );
  });
});
