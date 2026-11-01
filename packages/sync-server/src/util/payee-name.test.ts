import { describe, expect, it } from 'vitest';

import type { Transaction } from '#app-gocardless/gocardless-node.types';

import { formatPayeeName } from './payee-name';

const DEBTOR = 'CHRIS EXAMPLE';
const CREDITOR = 'JOHN EXAMPLE';
const IBAN = 'DE89370400440532013000';
const MASKED_IBAN = '(DE89 XXX 3000)';

function makeTransaction(
  amount: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    transactionAmount: { amount, currency: 'EUR' },
    ...overrides,
  };
}

const nullAccount = null as unknown as Transaction['creditorAccount'];

describe('formatPayeeName', () => {
  describe('white box: MC/DC on amount > 0 || Object.is(amount, 0)', () => {
    it('[CB-01] (A=T -> T) uses the debtor name for a positive amount', () => {
      const trans = makeTransaction('25.00', {
        debtorName: DEBTOR,
        creditorName: CREDITOR,
      });

      expect(formatPayeeName(trans)).toBe('Chris Example');
    });

    it('[CB-02] (A=F, B=T -> T) uses the debtor name for a zero amount', () => {
      const trans = makeTransaction('0.00', {
        debtorName: DEBTOR,
        creditorName: CREDITOR,
      });

      expect(formatPayeeName(trans)).toBe('Chris Example');
    });

    it('[CB-03] (A=F, B=F -> F) uses the creditor name for a negative amount', () => {
      const trans = makeTransaction('-25.00', {
        debtorName: DEBTOR,
        creditorName: CREDITOR,
      });

      expect(formatPayeeName(trans)).toBe('John Example');
    });
  });

  describe('white box: decision coverage on the account fallback', () => {
    it('[CB-04] does not take the other side account when the primary name exists', () => {
      const trans = makeTransaction('25.00', {
        debtorName: DEBTOR,
        creditorAccount: { iban: IBAN },
      });

      expect(formatPayeeName(trans)).toBe('Chris Example');
    });

    it('[CB-05] falls back to the debtor name and account when the creditor fields are missing', () => {
      const trans = makeTransaction('-25.00', {
        debtorName: DEBTOR,
        debtorAccount: { iban: IBAN },
      });

      expect(formatPayeeName(trans)).toBe(`Chris Example ${MASKED_IBAN}`);
    });

    it('[CB-06] falls back to the creditor name and account when the debtor fields are missing', () => {
      const trans = makeTransaction('25.00', {
        creditorName: CREDITOR,
        creditorAccount: { iban: IBAN },
      });

      expect(formatPayeeName(trans)).toBe(`John Example ${MASKED_IBAN}`);
    });
  });

  describe('white box: MC/DC on the name fallback chain', () => {
    it('[CB-07] uses remittanceInformationUnstructured when there is no name', () => {
      const trans = makeTransaction('-25.00', {
        remittanceInformationUnstructured: 'RENT MARCH',
        remittanceInformationUnstructuredArray: ['IGNORED'],
        additionalInformation: 'IGNORED',
      });

      expect(formatPayeeName(trans)).toBe('Rent March');
    });

    it('[CB-08] uses remittanceInformationUnstructuredArray when there is no name or remittance text', () => {
      const trans = makeTransaction('-25.00', {
        remittanceInformationUnstructuredArray: ['NETFLIX'],
        additionalInformation: 'IGNORED',
      });

      expect(formatPayeeName(trans)).toBe('Netflix');
    });

    it('[CB-09] uses additionalInformation when every other field is missing', () => {
      const trans = makeTransaction('-25.00', {
        additionalInformation: 'CARD PAYMENT',
      });

      expect(formatPayeeName(trans)).toBe('Card Payment');
    });

    it('[CB-10] returns an empty string when no field has a value', () => {
      const trans = makeTransaction('-25.00');

      expect(formatPayeeName(trans)).toBe('');
    });
  });

  describe("white box: MC/DC on typeof account === 'object' && account && account.iban", () => {
    it('[CB-11] (A=T, B=T, C=T -> T) appends the masked IBAN', () => {
      const trans = makeTransaction('-25.00', {
        creditorName: CREDITOR,
        creditorAccount: { iban: IBAN },
      });

      expect(formatPayeeName(trans)).toBe(`John Example ${MASKED_IBAN}`);
    });

    it('[CB-12] (A=F -> F) ignores an account given as a string', () => {
      const trans = makeTransaction('-25.00', {
        creditorName: CREDITOR,
        creditorAccount: IBAN,
      });

      expect(formatPayeeName(trans)).toBe('John Example');
    });

    it('[CB-13] (A=T, B=F -> F) ignores a null account', () => {
      const trans = makeTransaction('-25.00', {
        creditorName: CREDITOR,
        creditorAccount: nullAccount,
      });

      expect(formatPayeeName(trans)).toBe('John Example');
    });

    it('[CB-14] (A=T, B=T, C=F -> F) ignores an account without an IBAN', () => {
      const trans = makeTransaction('-25.00', {
        creditorName: CREDITOR,
        creditorAccount: {},
      });

      expect(formatPayeeName(trans)).toBe('John Example');
    });
  });

  describe('black box: boundary values on the amount sign', () => {
    it.each([
      {
        id: 'CP-01',
        scenario: 'treats the smallest positive amount as a credit',
        amount: '0.01',
        expected: 'Chris Example',
      },
      {
        id: 'CP-02',
        scenario: 'treats the smallest negative amount as a debit',
        amount: '-0.01',
        expected: 'John Example',
      },
      {
        id: 'CP-03',
        scenario: 'treats a negative zero amount as a debit',
        amount: '-0.00',
        expected: 'John Example',
      },
    ])('[$id] $scenario', ({ amount, expected }) => {
      const trans = makeTransaction(amount, {
        debtorName: DEBTOR,
        creditorName: CREDITOR,
      });

      expect(formatPayeeName(trans)).toBe(expected);
    });
  });

  describe('black box: equivalence partitioning on the name fields', () => {
    it('[CP-04] treats an empty primary name as missing', () => {
      const trans = makeTransaction('25.00', {
        debtorName: '',
        creditorName: CREDITOR,
      });

      expect(formatPayeeName(trans)).toBe('John Example');
    });

    it('[CP-05] treats an empty remittance array as missing', () => {
      const trans = makeTransaction('-25.00', {
        remittanceInformationUnstructuredArray: [],
        additionalInformation: 'CARD PAYMENT',
      });

      expect(formatPayeeName(trans)).toBe('Card Payment');
    });

    it('[CP-06] joins every remittance array item with a comma', () => {
      const trans = makeTransaction('-25.00', {
        remittanceInformationUnstructuredArray: ['NETFLIX', 'MONTHLY PLAN'],
      });

      expect(formatPayeeName(trans)).toBe('Netflix, Monthly Plan');
    });

    it('[CP-07] shows only the masked IBAN when there is no name at all', () => {
      const trans = makeTransaction('-25.00', {
        debtorAccount: { iban: IBAN },
      });

      expect(formatPayeeName(trans)).toBe(MASKED_IBAN);
    });
  });

  describe('black box: boundary values on the IBAN length', () => {
    it.each([
      {
        id: 'CP-08',
        scenario: 'masks the shortest IBAN in use (Norway, 15 characters)',
        iban: 'NO9386011117947',
        expected: 'John Example (NO93 XXX 7947)',
      },
      {
        id: 'CP-09',
        scenario: 'masks the longest IBAN in use (Russia, 33 characters)',
        iban: 'RU0304452522540817810538091310419',
        expected: 'John Example (RU03 XXX 0419)',
      },
    ])('[$id] $scenario', ({ iban, expected }) => {
      const trans = makeTransaction('-25.00', {
        creditorName: CREDITOR,
        creditorAccount: { iban },
      });

      const result = formatPayeeName(trans);
      expect(result).toBe(expected);
      expect(result).not.toContain(iban);
    });
  });
});
