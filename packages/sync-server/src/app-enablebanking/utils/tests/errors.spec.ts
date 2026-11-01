import { describe, expect, it } from 'vitest';

import {
  EnableBankingError,
  handleEnableBankingError,
} from '#app-enablebanking/utils/errors';

describe('EnableBankingError', () => {
  it('should create an error with type and code', () => {
    const error = new EnableBankingError(
      'INVALID_INPUT',
      'MISSING_FIELD',
      'oops',
    );
    expect(error.error_type).toBe('INVALID_INPUT');
    expect(error.error_code).toBe('MISSING_FIELD');
    expect(error.message).toBe('oops');
    expect(error.name).toBe('EnableBankingError');
  });

  it('should use default message when not provided', () => {
    const error = new EnableBankingError('INTERNAL_ERROR', 'UNKNOWN');
    expect(error.message).toBe(
      'Enable Banking error: INTERNAL_ERROR - UNKNOWN',
    );
  });
});

describe('handleEnableBankingError', () => {
  it('should return INVALID_ACCESS_TOKEN for 401', () => {
    const error = handleEnableBankingError(401, { message: 'Unauthorized' });
    expect(error.error_type).toBe('Unauthorized');
    expect(error.error_code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('should return INVALID_ACCESS_TOKEN for 403', () => {
    const error = handleEnableBankingError(403, { message: 'Forbidden' });
    expect(error.error_type).toBe('Forbidden');
    expect(error.error_code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('should return RATE_LIMIT_EXCEEDED for 429', () => {
    const error = handleEnableBankingError(429, {
      message: 'Too many requests',
    });
    expect(error.error_type).toBe('Too many requests');
    expect(error.error_code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should return NOT_FOUND for 404', () => {
    const error = handleEnableBankingError(404, { message: 'Not found' });
    expect(error.error_type).toBe('Not found');
    expect(error.error_code).toBe('NOT_FOUND');
  });

  it('should detect session-related errors as INVALID_ACCESS_TOKEN', () => {
    const error = handleEnableBankingError(400, {
      error: 'CLOSED_SESSION',
      message: 'session closed',
    });
    expect(error.error_type).toBe('session closed');
    expect(error.error_code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('should detect EXPIRED_SESSION as INVALID_ACCESS_TOKEN', () => {
    const error = handleEnableBankingError(400, {
      error: 'EXPIRED_SESSION',
      message: 'expired',
    });
    expect(error.error_type).toBe('expired');
    expect(error.error_code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('should return INTERNAL_ERROR for 500+', () => {
    const error = handleEnableBankingError(500, { message: 'Server error' });
    expect(error.error_type).toBe('Server error');
    expect(error.error_code).toBe('INTERNAL_ERROR');
  });

  it('should handle string body', () => {
    const error = handleEnableBankingError(500, 'raw error text');
    expect(error.message).toBe('raw error text');
    expect(error.error_type).toBe('raw error text');
    expect(error.error_code).toBe('INTERNAL_ERROR');
  });

  it('should handle null body', () => {
    const error = handleEnableBankingError(500, null);
    expect(error).toBeInstanceOf(EnableBankingError);
  });
});

describe('handleEnableBankingError - MC/DC e valores-limite (PTOSS-2)', () => {
  const code = (status: number, body?: unknown) =>
    handleEnableBankingError(status, body).error_code;

  describe('caixa-branca: D1 (401 || 403)', () => {
    it.each([
      { id: 'CB-01', status: 401, expected: 'INVALID_ACCESS_TOKEN' },
      { id: 'CB-02', status: 403, expected: 'INVALID_ACCESS_TOKEN' },
      { id: 'CB-03', status: 402, expected: 'INVALID_INPUT' },
    ])('[$id] status $status gives $expected', ({ status, expected }) => {
      // Arrange
      const body = { message: 'bad request' };
      // Act
      const result = code(status, body);
      // Assert
      expect(result).toBe(expected);
    });
  });

  describe('caixa-branca: D4 (>= 400 && < 500) e fronteiras', () => {
    it.each([
      { id: 'CB-04', status: 399, expected: 'INTERNAL_ERROR' },
      { id: 'CB-05', status: 400, expected: 'INVALID_INPUT' },
      { id: 'CB-06', status: 499, expected: 'INVALID_INPUT' },
      { id: 'CB-07', status: 500, expected: 'INTERNAL_ERROR' },
    ])('[$id] status $status gives $expected', ({ status, expected }) => {
      // Arrange
      const body = { message: 'bad request' };
      // Act
      const result = code(status, body);
      // Assert
      expect(result).toBe(expected);
    });
  });

  describe('caixa-branca: D5 (closed || expired || "session" || "expired")', () => {
    it.each([
      {
        id: 'CB-08',
        scenario: 'nenhuma condição verdadeira',
        body: { error: 'other_error', message: 'bad request' },
        expected: 'INVALID_INPUT',
      },
      {
        id: 'CB-09',
        scenario: 'só closed_session (A)',
        body: { error: 'closed_session', message: 'bad request' },
        expected: 'INVALID_ACCESS_TOKEN',
      },
      {
        id: 'CB-10',
        scenario: 'só expired_session (B)',
        body: { error: 'expired_session', message: 'bad request' },
        expected: 'INVALID_ACCESS_TOKEN',
      },
      {
        id: 'CB-11',
        scenario: 'só mensagem com "session" (C)',
        body: { error: 'other_error', message: 'Invalid session id' },
        expected: 'INVALID_ACCESS_TOKEN',
      },
      {
        id: 'CB-12',
        scenario: 'só mensagem com "expired" (D)',
        body: { error: 'other_error', message: 'Token has expired' },
        expected: 'INVALID_ACCESS_TOKEN',
      },
    ])('[$id] $scenario', ({ body, expected }) => {
      // Act
      const result = code(422, body);
      // Assert
      expect(result).toBe(expected);
    });
  });

  describe('caixa-preta: formatos de corpo', () => {
    it('[CP-01] body undefined em 500 devolve INTERNAL_ERROR com mensagem "unknown"', () => {
      // Act
      const err = handleEnableBankingError(500, undefined);
      // Assert
      expect(err.error_code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('"unknown"');
    });

    it('[CP-02] body null em 400 devolve INVALID_INPUT', () => {
      // Act
      const err = handleEnableBankingError(400, null);
      // Assert
      expect(err.error_code).toBe('INVALID_INPUT');
      expect(err.message).toBe('"unknown"');
    });

    it('[CP-03] body string em 4xx comum usa o texto como mensagem', () => {
      // Act
      const err = handleEnableBankingError(400, 'Bad input');
      // Assert
      expect(err.message).toBe('Bad input');
      expect(err.error_code).toBe('INVALID_INPUT');
    });

    it('[CP-04] body string com "session" em 4xx vira INVALID_ACCESS_TOKEN', () => {
      expect(code(400, 'Session not found')).toBe('INVALID_ACCESS_TOKEN');
    });

    it('[CP-05] mensagem em maiúsculas é reconhecida (sem diferenciar caixa)', () => {
      expect(code(400, { message: 'SESSION EXPIRED' })).toBe(
        'INVALID_ACCESS_TOKEN',
      );
    });

    it('[CP-06] objeto sem message usa o JSON do corpo como mensagem', () => {
      // Act
      const err = handleEnableBankingError(400, { error: 'other_error' });
      // Assert
      expect(err.message).toBe('{"error":"other_error"}');
      expect(err.error_code).toBe('INVALID_INPUT');
    });

    it('[CP-07] message que não é string cai no JSON do corpo', () => {
      // Act
      const err = handleEnableBankingError(400, { message: 123 });
      // Assert
      expect(err.message).toBe('{"message":123}');
      expect(err.error_code).toBe('INVALID_INPUT');
    });

    it('[CP-08] error que não é string é tratado como tipo desconhecido', () => {
      expect(code(400, { error: 42, message: 'bad request' })).toBe(
        'INVALID_INPUT',
      );
    });

    it('[CP-09] error e message vazios em 4xx devolvem INVALID_INPUT', () => {
      expect(code(400, { error: '', message: '' })).toBe('INVALID_INPUT');
    });

    it('[CP-10] palavra "session" só no JSON do corpo (sem message) é tratada como sessão', () => {
      // Caracterização do comportamento atual: o JSON inteiro vira "message"
      expect(code(400, { error: 'other_error', detail: 'session' })).toBe(
        'INVALID_ACCESS_TOKEN',
      );
    });
  });
});
