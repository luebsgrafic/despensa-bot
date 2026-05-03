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
  /**
   * Reconstruct the full SQL query from a tagged template call.
   * Tagged templates split on interpolations, so we need to interleave
   * the string parts with the values to get the full query text.
   */
  function reconstructQuery(strings: TemplateStringsArray, values: any[]): string {
    let query = '';
    for (let i = 0; i < strings.length; i++) {
      query += strings[i];
      if (i < values.length) {
        query += String(values[i]);
      }
    }
    return query;
  }

  const mockSql = (_strings: TemplateStringsArray, ...values: any[]) => {
    const query = reconstructQuery(_strings, values);

    if (query.includes('INSERT INTO products')) {
      const product = {
        id: state.nextId++,
        name: values[0],
        quantity: values[1],
        unit: values[2],
        zone: values[3],
        zone_id: values[4],
        min_stock: values[5],
        expiration_date: values[6],
        is_depleted: values[7],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.products.push(product);
      return [product];
    }

    // Match SELECT with JOIN (new format) or simple SELECT (legacy format)
    if (query.includes('LEFT JOIN zones')) {
      // New format with JOIN — extract WHERE conditions
      if (query.includes('WHERE p.id =')) {
        return [state.products.find((p: any) => p.id === values[values.length - 1])].filter(Boolean);
      }
      if (query.includes('WHERE p.zone =')) {
        return state.products.filter((p: any) => p.zone === values[values.length - 1]);
      }
      if (query.includes('WHERE p.name ILIKE')) {
        const pattern = (values[values.length - 1] as string).replace(/%/g, '').toLowerCase();
        return state.products.filter((p: any) => p.name.toLowerCase().includes(pattern));
      }
      if (query.includes('WHERE p.expiration_date')) {
        return state.products.filter(
          (p: any) =>
            p.expiration_date &&
            p.expiration_date <= values[values.length - 1] &&
            p.expiration_date >= new Date().toISOString().split('T')[0] &&
            !p.is_depleted,
        );
      }
      if (query.includes('WHERE p.min_stock')) {
        return state.products.filter(
          (p: any) => p.min_stock !== null && p.quantity <= p.min_stock && !p.is_depleted,
        );
      }
      if (query.includes('WHERE p.is_depleted = 1')) {
        return state.products.filter((p: any) => p.is_depleted);
      }
      // getAllProducts — no WHERE clause
      return [...state.products].sort(
        (a: any, b: any) => (a.zone || '').localeCompare(b.zone || '') || a.name.localeCompare(b.name),
      );
    }

    // Legacy format (SELECT * FROM products)
    if (query.includes('SELECT * FROM products WHERE id =')) {
      return [state.products.find((p: any) => p.id === values[0])].filter(Boolean);
    }

    if (query.includes('SELECT * FROM products ORDER BY zone, name')) {
      return [...state.products].sort(
        (a: any, b: any) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name),
      );
    }

    if (query.includes('SELECT * FROM products WHERE zone =')) {
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
        product.zone_id = values[4];
        product.min_stock = values[5];
        product.expiration_date = values[6];
        product.is_depleted = values[7];
        product.updated_at = new Date().toISOString();
      }
      return product ? [product] : [];
    }

    if (query.includes('DELETE FROM products')) {
      const idx = state.products.findIndex((p: any) => p.id === values[0]);
      if (idx !== -1) {
        state.products.splice(idx, 1);
        return [{ id: values[0] }];
      }
      return [];
    }

    if (query.includes('expiration_date') && !query.includes('p.expiration_date')) {
      return state.products.filter(
        (p: any) =>
          p.expiration_date &&
          p.expiration_date <= values[0] &&
          p.expiration_date >= new Date().toISOString().split('T')[0] &&
          !p.is_depleted,
      );
    }

    if (query.includes('min_stock') && !query.includes('p.min_stock')) {
      return state.products.filter(
        (p: any) => p.min_stock !== null && p.quantity <= p.min_stock && !p.is_depleted,
      );
    }

    if (query.includes('is_depleted = 1') && !query.includes('p.is_depleted')) {
      return state.products.filter((p: any) => p.is_depleted);
    }

    return [];
  };

  return {
    getSql: () => {
      const sqlFn = (strings: TemplateStringsArray, ...vals: any[]) => mockSql(strings, ...vals);
      sqlFn.unsafe = (query: string, values: any[]) => mockSql([query] as any, ...values);
      return sqlFn;
    },
  };
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
