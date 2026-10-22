import {
  MOCK_PROVIDER_ID,
  MOCK_PROVIDER_IDS,
  MockMcpAuthClientService,
  MockMcpClientService,
} from './mock-tools.services';

describe('MockMcpClientService (AC-6)', () => {
  let client: MockMcpClientService;
  const call = (name: string, args: Record<string, unknown> = {}, provider: string = MOCK_PROVIDER_ID) =>
    client.callTool({ name, args, provider });
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';
  const rows = async (query: string) => {
    const result = await call('read_query', { query });
    expect(result.isError).toBe(false);
    return JSON.parse(text(result));
  };

  beforeEach(() => {
    client = new MockMcpClientService();
  });

  describe('tools', () => {
    it('offers exactly the three sql_server tools with the right hints', async () => {
      const tools = await client.getTools(MOCK_PROVIDER_ID);

      expect(tools.map((t) => t.name)).toEqual(['table_schema', 'read_query', 'execute_write_query']);
      expect(tools.find((t) => t.name === 'read_query')?.annotations).toEqual({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'table_schema')?.annotations).toEqual({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'execute_write_query')?.annotations).toEqual({ destructiveHint: true });
    });

    it('offers nothing for a provider that is not mocked', async () => {
      await expect(client.getTools('notion')).resolves.toEqual([]);
      await expect(client.getResources('notion')).resolves.toEqual([]);
      await expect(client.readResource('notion', 'mock://sql_server/schema')).resolves.toBe('');
      await expect(client.readResource('slack', 'mock://sql_server/schema')).resolves.toBe('');
    });

    it('exposes the schema as a resource so every worker knows the real column names', async () => {
      const resources = await client.getResources(MOCK_PROVIDER_ID);
      expect(resources).toHaveLength(1);

      const schema = await client.readResource(MOCK_PROVIDER_ID, resources[0].uri);

      expect(schema).toContain('orders(id integer, customer text, total integer, status text, created_at text)');
      expect(schema).toContain('payments(id integer, order_id integer, amount integer, status text)');
      expect(schema).toContain('products(id integer, name text, price integer, stock integer)');
      await expect(client.readResource(MOCK_PROVIDER_ID, 'mock://other')).resolves.toBe('');
    });

    it('reports every mock agent as connected', async () => {
      const statuses = await new MockMcpAuthClientService().getConnectionStatus();

      expect(statuses.map((s) => s.provider_id)).toEqual(MOCK_PROVIDER_IDS);
      expect(MOCK_PROVIDER_IDS).toEqual(['sql_server', 'google_sheets', 'google_mail', 'slack', 'github']);
      expect(statuses.every((s) => s.is_connected && s.status === 'connected')).toBe(true);
    });

    it('serves tools for every connected agent, each with its own tool names', async () => {
      const names: Record<string, string[]> = {};
      for (const id of MOCK_PROVIDER_IDS) {
        names[id] = (await client.getTools(id)).map((t) => t.name);
        expect(names[id].length).toBeGreaterThan(0);
      }

      expect(names.google_mail).toContain('send_email');
      expect(names.slack).toContain('post_message');
      expect(names.github).toContain('create_issue');
      expect(names.google_sheets).toContain('read_range');
      expect(new Set(Object.values(names).flat()).size).toBe(Object.values(names).flat().length);
    });

    it('routes a call to the provider named in the request, and refuses a tool of another provider', async () => {
      const channels = await client.callTool({ name: 'list_channels', args: {}, provider: 'slack' });
      expect(channels.isError).toBe(false);
      expect(text(channels)).toContain('#ops');

      const wrong = await client.callTool({ name: 'list_channels', args: {}, provider: 'github' });
      expect(wrong.isError).toBe(true);
      expect(text(wrong)).toContain('không tồn tại');
    });

    it('serves each provider resource through readResource', async () => {
      const [resource] = await client.getResources('slack');

      await expect(client.readResource('slack', resource.uri)).resolves.toContain('#ops');
      await expect(client.getResources('google_mail')).resolves.toEqual([]);
    });
  });

  describe('table_schema', () => {
    it('describes every table, or one table', async () => {
      const all = text(await call('table_schema'));
      expect(all).toContain('products(id integer, name text, price integer, stock integer)');
      expect(all).toContain('orders(id integer, customer text, total integer, status text, created_at text)');
      expect(all).toContain('payments(id integer, order_id integer, amount integer, status text)');

      expect(text(await call('table_schema', { table: 'Products' }))).toBe(
        'products(id integer, name text, price integer, stock integer)',
      );
    });

    it('lists the values of every status column so the model does not guess them', async () => {
      const all = text(await call('table_schema'));

      expect(all).toContain("status có các giá trị: 'paid', 'pending'");
      expect(all).toContain("status có các giá trị: 'success'");
      expect(text(await call('table_schema', { table: 'products' }))).not.toContain('status có');
    });

    it('reflects status values written later', async () => {
      await call('execute_write_query', { query: "UPDATE orders SET status = 'cancelled' WHERE id = 102" });

      expect(text(await call('table_schema', { table: 'orders' }))).toContain("'cancelled', 'paid'");
    });

    it('fails for an unknown table and lists the available ones', async () => {
      const result = await call('table_schema', { table: 'users' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('orders, payments, products');
    });
  });

  describe('read_query runs real SQL', () => {
    it('selects rows, columns and honors LIMIT and ORDER BY', async () => {
      expect(await rows('SELECT * FROM products')).toHaveLength(3);
      expect(await rows('SELECT name, price FROM products ORDER BY price DESC LIMIT 1')).toEqual([
        { name: 'Giày thể thao', price: 699000 },
      ]);
    });

    it('supports comparison operators and AND in WHERE', async () => {
      expect(await rows('SELECT name FROM products WHERE stock > 10 AND price < 300000 ORDER BY id')).toEqual([
        { name: 'Áo thun' },
        { name: 'Quần jean' },
      ]);
    });

    it('answers the multi-aggregate order statistics query with CASE', async () => {
      // Đúng câu mà model đã viết và bị bản mock cũ từ chối ("Cột COUNT(*) AS total_orders không tồn tại").
      expect(
        await rows(
          "SELECT COUNT(*) AS total_orders, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_orders, " +
            "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_orders, " +
            "SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS total_revenue FROM orders",
        ),
      ).toEqual([{ total_orders: 3, paid_orders: 2, pending_orders: 1, total_revenue: 497000 }]);
    });

    it('supports aggregates, GROUP BY and JOIN', async () => {
      expect(await rows('SELECT SUM(amount) AS total_collected FROM payments')).toEqual([{ total_collected: 497000 }]);
      expect(await rows('SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY status')).toEqual([
        { status: 'paid', n: 2 },
        { status: 'pending', n: 1 },
      ]);
      expect(
        await rows(
          'SELECT o.customer, p.amount FROM orders o JOIN payments p ON p.order_id = o.id ORDER BY o.id',
        ),
      ).toEqual([
        { customer: 'An', amount: 398000 },
        { customer: 'Chi', amount: 99000 },
      ]);
    });

    it('finds the order without a payment with a subquery', async () => {
      expect(await rows('SELECT id, customer FROM orders WHERE id NOT IN (SELECT order_id FROM payments)')).toEqual([
        { id: 102, customer: 'Bình' },
      ]);
    });

    it('accepts WITH ... SELECT and a trailing semicolon', async () => {
      expect(await rows('WITH paid AS (SELECT * FROM orders WHERE status = \'paid\') SELECT COUNT(*) AS n FROM paid;')).toEqual([{ n: 2 }]);
    });

    it('is deterministic', async () => {
      expect(await rows('SELECT * FROM orders')).toEqual(await rows('SELECT * FROM orders'));
    });

    it.each([
      ['an unknown table', 'SELECT * FROM users', 'no such table'],
      ['an unknown column', 'SELECT total_amount FROM orders', 'no such column'],
      ['invalid SQL', 'SELECT FROM orders', 'syntax error'],
    ])('returns the database error for %s so the model can correct itself', async (_label, query, message) => {
      const result = await call('read_query', { query });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain(message);
    });

    it('appends the real schema to a wrong table or column error', async () => {
      const column = await call('read_query', { query: 'SELECT total_amount FROM orders' });
      const table = await call('execute_write_query', { query: 'UPDATE nope SET a = 1' });

      for (const result of [column, table]) {
        expect(result.isError).toBe(true);
        expect(text(result)).toContain('orders(id integer, customer text, total integer, status text, created_at text)');
      }
      expect(text(await call('read_query', { query: 'SELECT FROM orders' }))).not.toContain('Schema thật');
    });

    it.each([
      ['a DELETE', 'DELETE FROM products'],
      ['an UPDATE', 'UPDATE products SET price = 1'],
      ['a DROP', 'DROP TABLE products'],
      ['a second statement', 'SELECT 1; DELETE FROM products'],
      ['an empty query', ''],
    ])('refuses %s and changes nothing', async (_label, query) => {
      const result = await call('read_query', { query });

      expect(result.isError).toBe(true);
      expect(await rows('SELECT COUNT(*) AS n FROM products')).toEqual([{ n: 3 }]);
    });
  });

  describe('execute_write_query', () => {
    it('applies UPDATE, INSERT and DELETE to the in-memory database and reports the affected rows', async () => {
      const update = await call('execute_write_query', { query: 'UPDATE products SET price = 599000 WHERE id = 3' });
      expect(update.isError).toBe(false);
      expect(JSON.parse(text(update))).toEqual({ affectedRows: 1 });
      expect(await rows('SELECT price FROM products WHERE id = 3')).toEqual([{ price: 599000 }]);

      await call('execute_write_query', { query: "INSERT INTO products VALUES (4, 'Mũ', 50000, 5)" });
      expect(await rows('SELECT COUNT(*) AS n FROM products')).toEqual([{ n: 4 }]);

      const del = await call('execute_write_query', { query: 'DELETE FROM products WHERE stock < 10' });
      expect(JSON.parse(text(del))).toEqual({ affectedRows: 2 });
    });

    it('starts from the original data again on a new instance', async () => {
      await call('execute_write_query', { query: 'DELETE FROM products' });

      client = new MockMcpClientService();

      expect(await rows('SELECT COUNT(*) AS n FROM products')).toEqual([{ n: 3 }]);
    });

    it.each([
      ['a SELECT', 'SELECT 1'],
      ['a DROP', 'DROP TABLE orders'],
      ['two statements', 'UPDATE products SET price = 1; DELETE FROM products'],
      ['an empty query', ''],
    ])('refuses %s', async (_label, query) => {
      const result = await call('execute_write_query', { query });

      expect(result.isError).toBe(true);
      expect(await rows('SELECT COUNT(*) AS n FROM products')).toEqual([{ n: 3 }]);
    });

    it('returns the database error for a statement that fails', async () => {
      const result = await call('execute_write_query', { query: 'UPDATE nope SET a = 1' });

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('no such table');
    });
  });

  it('returns isError for an unknown tool and for another provider', async () => {
    expect((await call('drop_everything')).isError).toBe(true);
    expect((await call('read_query', { query: 'SELECT * FROM products' }, 'github')).isError).toBe(true);
  });
});
