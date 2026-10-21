import {
  MOCK_PROVIDER_ID,
  MockMcpAuthClientService,
  MockMcpClientService,
} from './mock-tools.services';

describe('MockMcpClientService (AC-8)', () => {
  const client = new MockMcpClientService();
  const call = (name: string, args: Record<string, unknown> = {}, provider: string = MOCK_PROVIDER_ID) =>
    client.callTool({ name, args, provider });
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';

  describe('tools', () => {
    it('offers exactly the three sql_server tools with the right hints', async () => {
      const tools = await client.getTools(MOCK_PROVIDER_ID);

      expect(tools.map((t) => t.name)).toEqual(['table_schema', 'read_query', 'execute_write_query']);
      expect(tools.find((t) => t.name === 'read_query')?.annotations).toEqual({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'table_schema')?.annotations).toEqual({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'execute_write_query')?.annotations).toEqual({ destructiveHint: true });
    });

    it('offers nothing for any other provider and has no resources', async () => {
      await expect(client.getTools('github')).resolves.toEqual([]);
      await expect(client.getResources()).resolves.toEqual([]);
      await expect(client.readResource()).resolves.toBe('');
    });

    it('reports the mock agent as connected', async () => {
      await expect(new MockMcpAuthClientService().getConnectionStatus()).resolves.toEqual([
        { provider_id: 'sql_server', is_connected: true, status: 'connected', connected_at: null },
      ]);
    });
  });

  describe('table_schema', () => {
    it('describes every table, or one table', async () => {
      const all = text(await call('table_schema'));
      expect(all).toContain('products(id int, name varchar, price int, stock int)');
      expect(all).toContain('orders(');
      expect(all).toContain('payments(');

      expect(text(await call('table_schema', { table: 'Products' }))).toBe(
        'products(id int, name varchar, price int, stock int)',
      );
    });

    it('fails for an unknown table', async () => {
      const result = await call('table_schema', { table: 'users' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('users');
    });
  });

  describe('read_query', () => {
    const rows = async (query: string) => JSON.parse(text(await call('read_query', { query })));

    it('selects all rows, specific columns, and honors LIMIT', async () => {
      expect(await rows('SELECT * FROM products')).toHaveLength(3);
      expect(await rows('select name, price from products limit 1')).toEqual([{ name: 'Áo thun', price: 99000 }]);
    });

    it('filters with a single equality (text and number)', async () => {
      expect(await rows("SELECT id FROM orders WHERE status = 'pending'")).toEqual([{ id: 102 }]);
      expect(await rows('SELECT name FROM products WHERE id = 3')).toEqual([{ name: 'Giày thể thao' }]);
    });

    it('computes COUNT and SUM deterministically', async () => {
      expect(await rows('SELECT COUNT(*) FROM orders')).toEqual([{ count: 3 }]);
      expect(await rows("SELECT COUNT(*) FROM orders WHERE status = 'paid'")).toEqual([{ count: 2 }]);
      expect(await rows('SELECT SUM(amount) FROM payments')).toEqual([{ sum: 497000 }]);
    });

    it('is the same on every call', async () => {
      expect(await rows('SELECT * FROM orders')).toEqual(await rows('SELECT * FROM orders'));
    });

    it.each([
      ['an unknown table', 'SELECT * FROM users'],
      ['an unknown column', 'SELECT salary FROM products'],
      ['a WHERE column that does not exist', 'SELECT * FROM products WHERE salary = 1'],
      ['an unsupported WHERE (AND)', "SELECT * FROM orders WHERE status = 'paid' AND id = 1"],
      ['SUM on a text column', 'SELECT SUM(name) FROM products'],
      ['a non-SELECT statement', 'DELETE FROM products'],
      ['an empty query', ''],
    ])('returns isError for %s', async (_label, query) => {
      const result = await call('read_query', { query });

      expect(result.isError).toBe(true);
      expect(text(result).length).toBeGreaterThan(0);
    });
  });

  describe('execute_write_query', () => {
    it.each(["UPDATE products SET price = 1 WHERE id = 1", "DELETE FROM orders WHERE id = 102", "INSERT INTO products VALUES (4, 'x', 1, 1)"])(
      'accepts %s and changes nothing',
      async (query) => {
        const result = await call('execute_write_query', { query });

        expect(result.isError).toBe(false);
        expect(JSON.parse(text(result)).affectedRows).toBe(1);
        // Dữ liệu mẫu không đổi dù "ghi".
        expect(JSON.parse(text(await call('read_query', { query: 'SELECT COUNT(*) FROM products' })))).toEqual([{ count: 3 }]);
      },
    );

    it('rejects a SELECT and a missing query', async () => {
      expect((await call('execute_write_query', { query: 'SELECT 1' })).isError).toBe(true);
      expect((await call('execute_write_query', {})).isError).toBe(true);
    });
  });

  it('returns isError for an unknown tool and for another provider', async () => {
    expect((await call('drop_everything')).isError).toBe(true);
    expect((await call('read_query', { query: 'SELECT * FROM products' }, 'github')).isError).toBe(true);
  });
});
