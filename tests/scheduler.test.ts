import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  products: {
    getExpiringProducts: vi.fn(),
    getLowStockProducts: vi.fn().mockResolvedValue([]),
    getExpiredProducts: vi.fn().mockResolvedValue([]),
  },
  movements: {
    getTopConsumed: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({})),
  },
}));

import { buildExpirationMessage } from '../src/services/scheduler';
import { products as mockedProducts } from '../src/db';

describe('buildExpirationMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should classify product expiring today as 🔴', () => {
    const today = new Date().toISOString().split('T')[0];
    const products = [
      {
        id: 1,
        name: 'Yogur',
        quantity: 4,
        unit: 'ud',
        zone: 'nevera',
        expiration_date: today,
        is_depleted: false,
      },
    ];

    const msg = buildExpirationMessage(products as any);

    expect(msg).toContain('🔴');
    expect(msg).toContain('Yogur');
    expect(msg).toContain('0 día(s)');
    expect(msg).not.toContain('🟠');
    expect(msg).not.toContain('🟡');
  });

  it('should classify product expiring in 2 days as 🟠', () => {
    const future = new Date();
    future.setDate(future.getDate() + 2);
    const futureStr = future.toISOString().split('T')[0];
    const products = [
      {
        id: 2,
        name: 'Queso',
        quantity: 1,
        unit: 'kg',
        zone: 'nevera',
        expiration_date: futureStr,
        is_depleted: false,
      },
    ];

    const msg = buildExpirationMessage(products as any);

    expect(msg).toContain('🟠');
    expect(msg).toContain('Queso');
    expect(msg).toContain('2 día(s)');
    expect(msg).not.toContain('🔴');
    expect(msg).not.toContain('🟡');
  });

  it('should classify product expiring in 6 days as 🟡', () => {
    const future = new Date();
    future.setDate(future.getDate() + 6);
    const futureStr = future.toISOString().split('T')[0];
    const products = [
      {
        id: 3,
        name: 'Galletas',
        quantity: 200,
        unit: 'g',
        zone: 'despensa',
        expiration_date: futureStr,
        is_depleted: false,
      },
    ];

    const msg = buildExpirationMessage(products as any);

    expect(msg).toContain('🟡');
    expect(msg).toContain('Galletas');
    expect(msg).toContain('6 día(s)');
    expect(msg).not.toContain('🔴');
    expect(msg).not.toContain('🟠');
  });

  it('should include 🔴, 🟠, 🟡 products together in correct order', () => {
    const today = new Date().toISOString().split('T')[0];
    const future3 = new Date();
    future3.setDate(future3.getDate() + 3);
    const future6 = new Date();
    future6.setDate(future6.getDate() + 6);

    const products = [
      {
        id: 1,
        name: 'Leche',
        quantity: 1,
        unit: 'L',
        zone: 'nevera',
        expiration_date: future3.toISOString().split('T')[0],
        is_depleted: false,
      },
      {
        id: 2,
        name: 'Yogur',
        quantity: 4,
        unit: 'ud',
        zone: 'nevera',
        expiration_date: today,
        is_depleted: false,
      },
      {
        id: 3,
        name: 'Pan',
        quantity: 1,
        unit: 'ud',
        zone: 'armario_cocina',
        expiration_date: future6.toISOString().split('T')[0],
        is_depleted: false,
      },
    ];

    const msg = buildExpirationMessage(products as any);

    const redIdx = msg.indexOf('🔴');
    const orangeIdx = msg.indexOf('🟠');
    const yellowIdx = msg.indexOf('🟡');

    expect(redIdx).toBeGreaterThanOrEqual(0);
    expect(orangeIdx).toBeGreaterThanOrEqual(0);
    expect(yellowIdx).toBeGreaterThanOrEqual(0);

    expect(redIdx).toBeLessThan(orangeIdx);
    expect(orangeIdx).toBeLessThan(yellowIdx);
  });

  it('should return empty string for empty product list', () => {
    const msg = buildExpirationMessage([] as any);
    expect(msg).toBe('');
  });

  it('should include product quantity and unit in the message', () => {
    const future = new Date();
    future.setDate(future.getDate() + 2);
    const products = [
      {
        id: 1,
        name: 'Arroz',
        quantity: 2,
        unit: 'kg',
        zone: 'despensa',
        expiration_date: future.toISOString().split('T')[0],
        is_depleted: false,
      },
    ];

    const msg = buildExpirationMessage(products as any);

    expect(msg).toContain('2kg');
    expect(msg).toContain('Arroz');
  });
});

describe('getExpiringProducts range queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should query getExpiringProducts with 0 days for today-only check', async () => {
    const mock = vi.mocked(mockedProducts.getExpiringProducts);
    mock.mockResolvedValueOnce([] as any);

    await mockedProducts.getExpiringProducts(0);

    expect(mock).toHaveBeenCalledWith(0);
  });

  it('should query getExpiringProducts with 3 days for near-expiry check', async () => {
    const mock = vi.mocked(mockedProducts.getExpiringProducts);
    mock.mockResolvedValueOnce([] as any);

    await mockedProducts.getExpiringProducts(3);

    expect(mock).toHaveBeenCalledWith(3);
  });

  it('should query getExpiringProducts with 7 days for full week check', async () => {
    const mock = vi.mocked(mockedProducts.getExpiringProducts);
    mock.mockResolvedValueOnce([] as any);

    await mockedProducts.getExpiringProducts(7);

    expect(mock).toHaveBeenCalledWith(7);
  });
});
