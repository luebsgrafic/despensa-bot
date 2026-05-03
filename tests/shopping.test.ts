import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  items: [] as any[],
  nextId: 1,
};

function resetState() {
  state.items = [];
  state.nextId = 1;
}

vi.mock('../src/db/schema', () => {
  const mockSql = (_strings: TemplateStringsArray, ...values: any[]) => {
    const query = _strings.join('?');

    if (query.includes('INSERT INTO shopping_list')) {
      const item = {
        id: state.nextId++,
        product_name: values[0],
        quantity: values[1],
        unit: values[2],
        added_by: values[3],
        is_checked: 0,
        created_at: new Date().toISOString(),
      };
      state.items.push(item);
      return [item];
    }

    if (query.includes('SELECT * FROM shopping_list WHERE id = ?')) {
      return [state.items.find((i: any) => i.id === values[0])].filter(Boolean);
    }

    if (query.includes('ORDER BY is_checked, created_at DESC')) {
      return [...state.items].sort(
        (a: any, b: any) =>
          a.is_checked - b.is_checked ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }

    if (query.includes('is_checked = 0')) {
      return state.items.filter((i: any) => !i.is_checked);
    }

    if (query.includes('UPDATE shopping_list SET is_checked =')) {
      const item = state.items.find((i: any) => i.id === values[1]);
      if (item) item.is_checked = values[0];
      return item ? [item] : [];
    }

    if (query.includes('DELETE FROM shopping_list WHERE id = ?')) {
      const idx = state.items.findIndex((i: any) => i.id === values[0]);
      if (idx !== -1) {
        state.items.splice(idx, 1);
        return { count: 1 };
      }
      return { count: 0 };
    }

    if (query.includes("DELETE FROM shopping_list WHERE is_checked = 1")) {
      const count = state.items.filter((i: any) => i.is_checked).length;
      for (let i = state.items.length - 1; i >= 0; i--) {
        if (state.items[i].is_checked) state.items.splice(i, 1);
      }
      return { count };
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

import { shopping } from '../src/db';

describe('Shopping List Repository', () => {
  beforeEach(() => {
    resetState();
  });

  describe('addShoppingItem', () => {
    it('should add an item to the shopping list', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Leche',
        quantity: 2,
        unit: 'L',
        added_by: 123456,
      });

      expect(item.product_name).toBe('Leche');
      expect(item.quantity).toBe(2);
      expect(item.unit).toBe('L');
      expect(item.added_by).toBe(123456);
      expect(item.is_checked).toBe(0);
    });
  });

  describe('getAllShoppingItems', () => {
    it('should return all items sorted by checked status and date', async () => {
      await shopping.addShoppingItem({ product_name: 'Pan', quantity: 1, unit: 'ud', added_by: 1 });
      await shopping.addShoppingItem({ product_name: 'Leche', quantity: 1, unit: 'L', added_by: 1 });

      const items = await shopping.getAllShoppingItems();

      expect(items).toHaveLength(2);
    });
  });

  describe('toggleShoppingItem', () => {
    it('should toggle the checked status', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Huevos',
        quantity: 12,
        unit: 'ud',
        added_by: 1,
      });

      const toggled = await shopping.toggleShoppingItem(item.id);
      expect(toggled!.is_checked).toBe(1);

      const toggledBack = await shopping.toggleShoppingItem(item.id);
      expect(toggledBack!.is_checked).toBe(0);
    });
  });

  describe('removeShoppingItem', () => {
    it('should remove an item by id', async () => {
      const item = await shopping.addShoppingItem({
        product_name: 'Temp',
        quantity: 1,
        unit: 'ud',
        added_by: 1,
      });

      const removed = await shopping.removeShoppingItem(item.id);
      expect(removed).toBe(true);

      const items = await shopping.getAllShoppingItems();
      expect(items).toHaveLength(0);
    });
  });

  describe('clearCheckedItems', () => {
    it('should remove all checked items', async () => {
      const item1 = await shopping.addShoppingItem({ product_name: 'A', quantity: 1, unit: 'ud', added_by: 1 });
      const item2 = await shopping.addShoppingItem({ product_name: 'B', quantity: 1, unit: 'ud', added_by: 1 });

      await shopping.toggleShoppingItem(item1.id);

      const count = await shopping.clearCheckedItems();
      expect(count).toBe(1);

      const remaining = await shopping.getAllShoppingItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].product_name).toBe('B');
    });
  });
});
