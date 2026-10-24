import { extractMonetaryAmount } from './policy-amount-extractor.util';

describe('policy-amount-extractor.util', () => {
  it('extracts numeric amount from various property keys', () => {
    expect(extractMonetaryAmount({ amount: 150000 })).toBe(150000);
    expect(extractMonetaryAmount({ requestedAmount: 2500000 })).toBe(2500000);
    expect(extractMonetaryAmount({ refundAmount: 99000 })).toBe(99000);
    expect(extractMonetaryAmount({ totalAmount: 50000 })).toBe(50000);
    expect(extractMonetaryAmount({ price: 120000 })).toBe(120000);
  });

  it('parses string representations with currency formatting', () => {
    expect(extractMonetaryAmount({ amount: '2,500,000 VNĐ' })).toBe(2500000);
    expect(extractMonetaryAmount({ amount: '99.000' })).toBe(99);
  });

  it('returns 0 when no valid amount is found', () => {
    expect(extractMonetaryAmount({})).toBe(0);
    expect(extractMonetaryAmount({ note: 'no amount' })).toBe(0);
  });
});
