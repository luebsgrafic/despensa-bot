import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  products: [] as any[],
  shoppingItems: [] as any[],
  nextProductId: 1,
  nextShoppingId: 1,
};

function resetState() {
  state.products = [];
  state.shoppingItems = [];
  state.nextProductId = 1;
  state.nextShoppingId = 1;
}

vi.mock('../src/db/schema', () => {
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

    // Upsert: SELECT for existing product by name + zone_id + unit
    if (query.includes('LOWER(name) = LOWER(') && query.includes('zone_id IS NOT DISTINCT FROM')) {
      const searchName = String(values[0]).toLowerCase();
      const searchZoneId = values[1];
      const searchUnit = values.length > 2 ? values[2] : undefined;
      const found = state.products.find((p: any) =>
        p.name.toLowerCase() === searchName &&
        (p.zone_id === searchZoneId || (p.zone_id === null && searchZoneId === null)) &&
        (searchUnit === undefined || p.unit === searchUnit)
      );
      return found ? [found] : [];
    }

    if (query.includes('INSERT INTO products')) {
      const product = {
        id: state.nextProductId++,
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

    if (query.includes('INSERT INTO shopping_list')) {
      const item = {
        id: state.nextShoppingId++,
        product_name: values[0],
        quantity: values[1],
        unit: values[2],
        added_by: values[3],
        is_checked: 0,
        created_at: new Date().toISOString(),
      };
      state.shoppingItems.push(item);
      return [item];
    }

    if (query.includes('ORDER BY is_checked, created_at DESC')) {
      return [...state.shoppingItems].sort(
        (a: any, b: any) =>
          a.is_checked - b.is_checked ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }

    if (query.includes('SELECT * FROM shopping_list WHERE id =')) {
      return [state.shoppingItems.find((i: any) => i.id === values[0])].filter(Boolean);
    }

    if (query.includes('WHERE p.is_depleted = 1')) {
      return state.products.filter((p: any) => p.is_depleted);
    }

    if (query.includes('SELECT * FROM products ORDER BY zone, name') ||
        (query.includes('SELECT * FROM products') && !query.includes('WHERE') && !query.includes('INSERT') && !query.includes('UPDATE') && !query.includes('DELETE'))) {
      return [...state.products].sort(
        (a: any, b: any) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name),
      );
    }

    if (query.includes('SELECT * FROM products WHERE id =')) {
      return [state.products.find((p: any) => p.id === values[0])].filter(Boolean);
    }

    if (query.includes('expiration_date') && !query.includes('p.expiration_date')) {
      const todayStr = values[0];
      const thresholdStr = values[1] || values[0];
      return state.products.filter(
        (p: any) =>
          p.expiration_date &&
          p.expiration_date >= todayStr &&
          p.expiration_date <= thresholdStr &&
          !p.is_depleted,
      );
    }

    if (query.includes('UPDATE products SET')) {
      const product = state.products.find((p: any) => p.id === values[values.length - 1]);
      if (product) {
        if (query.includes('name =')) {
          // From updateProduct() — full field list
          product.name = values[0];
          product.quantity = values[1];
          product.unit = values[2];
          product.zone = values[3];
          product.zone_id = values[4];
          product.min_stock = values[5];
          product.expiration_date = values[6];
          product.is_depleted = values[7];
        } else {
          // From createProduct() upsert — only quantity, unit, is_depleted
          product.quantity = values[0];
          product.unit = values[1];
          product.is_depleted = values[2];
        }
        product.updated_at = new Date().toISOString();
      }
      return product ? [product] : [];
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

vi.mock('../src/db/movements', () => ({
  logMovement: vi.fn(),
}));

import { products, shopping } from '../src/db';

describe('Product unit validation', () => {
  beforeEach(() => {
    resetState();
  });

  it('should create product with unit: ud', async () => {
    const p = await products.createProduct({
      name: 'Huevos', quantity: 12, unit: 'ud', zone: 'nevera',
    });
    expect(p.unit).toBe('ud');
    expect(p.quantity).toBe(12);
  });

  it('should create product with unit: kg', async () => {
    const p = await products.createProduct({
      name: 'Arroz', quantity: 2, unit: 'kg', zone: 'despensa',
    });
    expect(p.unit).toBe('kg');
    expect(p.quantity).toBe(2);
  });

  it('should create product with unit: L', async () => {
    const p = await products.createProduct({
      name: 'Leche', quantity: 1, unit: 'L', zone: 'nevera',
    });
    expect(p.unit).toBe('L');
  });

  it('should create product with unit: g', async () => {
    const p = await products.createProduct({
      name: 'Harina', quantity: 500, unit: 'g', zone: 'despensa',
    });
    expect(p.unit).toBe('g');
    expect(p.quantity).toBe(500);
  });

  it('should create product with unit: ml', async () => {
    const p = await products.createProduct({
      name: 'Aceite', quantity: 250, unit: 'ml', zone: 'despensa',
    });
    expect(p.unit).toBe('ml');
    expect(p.quantity).toBe(250);
  });
});

describe('Shopping item unit validation', () => {
  beforeEach(() => {
    resetState();
  });

  it('should create shopping item with unit: ud', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Pan', quantity: 2, unit: 'ud', added_by: 1,
    });
    expect(item.unit).toBe('ud');
  });

  it('should create shopping item with unit: L', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Leche', quantity: 1, unit: 'L', added_by: 1,
    });
    expect(item.unit).toBe('L');
  });

  it('should create shopping item with unit: kg', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Patatas', quantity: 3, unit: 'kg', added_by: 1,
    });
    expect(item.unit).toBe('kg');
  });

  it('should create shopping item with unit: g', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Queso', quantity: 200, unit: 'g', added_by: 1,
    });
    expect(item.unit).toBe('g');
  });

  it('should create shopping item with unit: ml', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Aceite', quantity: 500, unit: 'ml', added_by: 1,
    });
    expect(item.unit).toBe('ml');
  });
});

describe('Display format: quantity + unit (no space)', () => {
  beforeEach(() => {
    resetState();
  });

  it('should format product display as quantity+unit in pantry', async () => {
    const p = await products.createProduct({
      name: 'Arroz', quantity: 2, unit: 'kg', zone: 'despensa',
    });
    const display = `${p.quantity}${p.unit}`;
    expect(display).toBe('2kg');
  });

  it('should format shopping item display as quantity+unit', async () => {
    const item = await shopping.addShoppingItem({
      product_name: 'Leche', quantity: 1, unit: 'L', added_by: 1,
    });
    const display = `${item.quantity}${item.unit}`;
    expect(display).toBe('1L');
  });

  it('should format expiration alert display as quantity+unit', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const p = await products.createProduct({
      name: 'Yogur', quantity: 4, unit: 'ud', zone: 'nevera',
      expiration_date: tomorrow.toISOString().split('T')[0],
    });
    const display = `${p.quantity}${p.unit}`;
    expect(display).toBe('4ud');
  });

  it('should create product with quantity=0.5 and verify format', async () => {
    const p = await products.createProduct({
      name: 'Leche', quantity: 0.5, unit: 'L', zone: 'nevera',
    });
    const display = `${p.quantity}${p.unit}`;
    expect(display).toBe('0.5L');
  });
});

describe('Upsert with unit awareness', () => {
  beforeEach(() => {
    resetState();
  });

  it('should sum quantities when unit matches (500g + 500g = 1000g)', async () => {
    const p1 = await products.createProduct({
      name: 'Harina', quantity: 500, unit: 'g', zone: 'despensa',
    });
    const p2 = await products.createProduct({
      name: 'Harina', quantity: 500, unit: 'g', zone: 'despensa',
    });

    const all = await products.getAllProducts();
    expect(all.length).toBe(1);
    expect(all[0].quantity).toBe(1000);
    expect(all[0].unit).toBe('g');
    expect(p2.id).toBe(p1.id);
  });

  it('should keep products separate when unit differs (1kg vs 500g)', async () => {
    const p1 = await products.createProduct({
      name: 'Arroz', quantity: 1, unit: 'kg', zone: 'despensa',
    });
    const p2 = await products.createProduct({
      name: 'Arroz', quantity: 500, unit: 'g', zone: 'despensa',
    });

    const all = await products.getAllProducts();
    expect(all.length).toBe(2);
    const kgProduct = all.find((p: any) => p.unit === 'kg');
    const gProduct = all.find((p: any) => p.unit === 'g');
    expect(kgProduct).toBeDefined();
    expect(gProduct).toBeDefined();
    expect(kgProduct!.quantity).toBe(1);
    expect(gProduct!.quantity).toBe(500);
  });

  it('should keep products separate when unit differs (2L vs 500ml)', async () => {
    const p1 = await products.createProduct({
      name: 'Leche', quantity: 2, unit: 'L', zone: 'nevera',
    });
    const p2 = await products.createProduct({
      name: 'Leche', quantity: 500, unit: 'ml', zone: 'nevera',
    });

    const all = await products.getAllProducts();
    expect(all.length).toBe(2);
    expect(all[0].unit).toBe('L');
    expect(all[1].unit).toBe('ml');
  });

  it('should sum when same product, same zone, same unit (3ud + 2ud = 5ud)', async () => {
    await products.createProduct({
      name: 'Huevos', quantity: 3, unit: 'ud', zone: 'nevera',
    });
    const p2 = await products.createProduct({
      name: 'Huevos', quantity: 2, unit: 'ud', zone: 'nevera',
    });

    const all = await products.getAllProducts();
    expect(all.length).toBe(1);
    expect(all[0].quantity).toBe(5);
    expect(all[0].unit).toBe('ud');
  });
});
