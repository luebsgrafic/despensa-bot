import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable state for the mock
const state = {
  products: [] as any[],
  nextId: 1,
};

function resetState() {
  state.products = [];
  state.nextId = 1;
}

vi.mock('../src/db/schema', () => {
  const mockSql = (_strings: TemplateStringsArray, ...values: any[]) => {
    const query = _strings.join('?');

    if (query.includes('INSERT INTO products')) {
      const product = {
        id: state.nextId++,
        name: values[0],
        quantity: values[1],
        unit: values[2],
        zone: values[3],
        min_stock: values[4],
        expiration_date: values[5],
        is_depleted: values[6],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.products.push(product);
      return [product];
    }

    if (query.includes('SELECT * FROM products WHERE id = ?')) {
      return [state.products.find((p: any) => p.id === values[0])].filter(Boolean);
    }

    if (query.includes('SELECT * FROM products ORDER BY zone, name')) {
      return [...state.products].sort(
        (a: any, b: any) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name),
      );
    }

    if (query.includes('SELECT * FROM products WHERE zone = ?')) {
      return state.products.filter((p: any) => p.zone === values[0]);
    }

    if (query.includes('ILIKE')) {
      const pattern = (values[0] as string).replace(/%/g, '').toLowerCase();
      return state.products.filter((p: any) => p.name.toLowerCase().includes(pattern));
    }

    if (query.includes('UPDATE products SET')) {
      const product = state.products.find((p: any) => p.id === values[values.length - 1]);
      if (product) {
        product.name = values[0];
        product.quantity = values[1];
        product.unit = values[2];
        product.zone = values[3];
        product.min_stock = values[4];
        product.expiration_date = values[5];
        product.is_depleted = values[6];
        product.updated_at = new Date().toISOString();
      }
      return product ? [product] : [];
    }

    if (query.includes('DELETE FROM products WHERE id = ?')) {
      const idx = state.products.findIndex((p: any) => p.id === values[0]);
      if (idx !== -1) {
        state.products.splice(idx, 1);
        return { count: 1 };
      }
      return { count: 0 };
    }

    if (query.includes('expiration_date')) {
      return state.products.filter(
        (p: any) =>
          p.expiration_date &&
          p.expiration_date <= values[0] &&
          p.expiration_date >= new Date().toISOString().split('T')[0] &&
          !p.is_depleted,
      );
    }

    if (query.includes('min_stock')) {
      return state.products.filter(
        (p: any) => p.min_stock !== null && p.quantity <= p.min_stock && !p.is_depleted,
      );
    }

    if (query.includes('is_depleted = 1')) {
      return state.products.filter((p: any) => p.is_depleted);
    }

    return [];
  };

  return { getSql: () => mockSql };
});

import { products } from '../src/db';

describe('Products Repository', () => {
  beforeEach(() => {
    resetState();
  });

  describe('createProduct', () => {
    it('should create a product with all fields', async () => {
      const product = await products.createProduct({
        name: 'Leche',
        quantity: 2,
        unit: 'L',
        zone: 'nevera',
        min_stock: 1,
        expiration_date: '2026-06-15',
      });

      expect(product.name).toBe('Leche');
      expect(product.quantity).toBe(2);
      expect(product.unit).toBe('L');
      expect(product.zone).toBe('nevera');
      expect(product.min_stock).toBe(1);
      expect(product.expiration_date).toBe('2026-06-15');
      expect(product.is_depleted).toBe(0);
      expect(product.id).toBeDefined();
    });

    it('should mark product as depleted when quantity is 0', async () => {
      const product = await products.createProduct({
        name: 'Pan',
        quantity: 0,
        unit: 'ud',
        zone: 'armario_cocina',
      });

      expect(product.is_depleted).toBe(1);
    });

    it('should create product without optional fields', async () => {
      const product = await products.createProduct({
        name: 'Sal',
        quantity: 1,
        unit: 'kg',
        zone: 'despensa',
      });

      expect(product.name).toBe('Sal');
      expect(product.min_stock).toBeNull();
      expect(product.expiration_date).toBeNull();
    });
  });

  describe('getAllProducts', () => {
    it('should return all products ordered by zone and name', async () => {
      await products.createProduct({ name: 'Zanahoria', quantity: 5, unit: 'ud', zone: 'nevera' });
      await products.createProduct({ name: 'Arroz', quantity: 2, unit: 'kg', zone: 'despensa' });
      await products.createProduct({ name: 'Leche', quantity: 1, unit: 'L', zone: 'nevera' });

      const all = await products.getAllProducts();

      expect(all).toHaveLength(3);
      expect(all[0].zone).toBe('despensa');
      expect(all[1].zone).toBe('nevera');
    });
  });

  describe('getProductsByZone', () => {
    it('should return only products in the specified zone', async () => {
      await products.createProduct({ name: 'Leche', quantity: 1, unit: 'L', zone: 'nevera' });
      await products.createProduct({ name: 'Pan', quantity: 1, unit: 'ud', zone: 'armario_cocina' });

      const neveraProducts = await products.getProductsByZone('nevera');

      expect(neveraProducts).toHaveLength(1);
      expect(neveraProducts[0].name).toBe('Leche');
    });
  });

  describe('searchProducts', () => {
    it('should find products by partial name match', async () => {
      await products.createProduct({ name: 'Leche entera', quantity: 1, unit: 'L', zone: 'nevera' });
      await products.createProduct({ name: 'Leche desnatada', quantity: 1, unit: 'L', zone: 'nevera' });
      await products.createProduct({ name: 'Pan', quantity: 1, unit: 'ud', zone: 'armario_cocina' });

      const results = await products.searchProducts('Leche');

      expect(results).toHaveLength(2);
    });
  });

  describe('updateProduct', () => {
    it('should update product quantity and mark as depleted', async () => {
      const product = await products.createProduct({
        name: 'Huevos',
        quantity: 12,
        unit: 'ud',
        zone: 'nevera',
        min_stock: 6,
      });

      const updated = await products.updateProduct(product.id, { quantity: 0 });

      expect(updated!.quantity).toBe(0);
      expect(updated!.is_depleted).toBe(1);
    });

    it('should move product to another zone', async () => {
      const product = await products.createProduct({
        name: 'Coca-Cola',
        quantity: 6,
        unit: 'ud',
        zone: 'nevera',
      });

      const updated = await products.updateProduct(product.id, { zone: 'despensa' });

      expect(updated!.zone).toBe('despensa');
    });
  });

  describe('deleteProduct', () => {
    it('should delete an existing product', async () => {
      const product = await products.createProduct({
        name: 'Temp',
        quantity: 1,
        unit: 'ud',
        zone: 'otros',
      });

      const deleted = await products.deleteProduct(product.id);
      expect(deleted).toBe(true);

      const found = await products.getProductById(product.id);
      expect(found).toBeUndefined();
    });
  });

  describe('getExpiringProducts', () => {
    it('should return products expiring within the given days', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      await products.createProduct({
        name: 'Yogur',
        quantity: 4,
        unit: 'ud',
        zone: 'nevera',
        expiration_date: tomorrowStr,
      });

      const expiring = await products.getExpiringProducts(3);
      expect(expiring.length).toBeGreaterThanOrEqual(1);
    });
  });
});
