import { OpenApiConverter } from './openapi-converter.util';
import { OpenAPIV3 } from 'openapi-types';

interface StrictJsonSchema {
  type: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
}

describe('OpenApiConverter', () => {
  describe('convertToMcpTools', () => {
    it('should convert a basic OpenAPI v3 document to MCP tools', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              summary: 'Get a list of users',
              parameters: [
                {
                  name: 'page',
                  in: 'query',
                  required: false,
                  schema: { type: 'number' },
                  description: 'Page number',
                },
              ],
              responses: { '200': { description: 'Success' } },
            },
            post: {
              summary: 'Create a user',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);

      expect(tools).toHaveLength(2);

      // Check GET tool
      const getTool = tools.find((t) => t.name === 'getUsers');
      expect(getTool).toBeDefined();
      expect(getTool?.description).toBe('Get a list of users');
      expect(getTool?.annotations?.readOnlyHint).toBe(true);
      expect(getTool?.annotations?.destructiveHint).toBe(false);
      const getSchema = getTool?.inputSchema as unknown as StrictJsonSchema;
      expect(getSchema.properties).toHaveProperty('page');
      expect(getSchema.properties?.page?.type).toBe('number');

      // Check POST tool (fallback name generation since no operationId)
      const postTool = tools.find((t) => t.name === 'post_users');
      expect(postTool).toBeDefined();
      expect(postTool?.description).toBe('Create a user');
      expect(postTool?.annotations?.readOnlyHint).toBe(false);
      expect(postTool?.annotations?.destructiveHint).toBe(true);
      const postSchema = postTool?.inputSchema as unknown as StrictJsonSchema;
      expect(postSchema.properties).toHaveProperty('requestBody');
      expect(postSchema.required).toContain('requestBody');
    });

    it('should ignore authorization headers', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Auth API', version: '1.0.0' },
        paths: {
          '/secure': {
            get: {
              operationId: 'getSecureData',
              parameters: [
                {
                  name: 'Authorization',
                  in: 'header',
                  required: true,
                  schema: { type: 'string' },
                },
                {
                  name: 'id',
                  in: 'query',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      const tool = tools[0];
      const schema = tool.inputSchema as unknown as StrictJsonSchema;

      expect(schema.properties).not.toHaveProperty('Authorization');
      expect(schema.properties).toHaveProperty('id');
      expect(schema.required).not.toContain('Authorization');
      expect(schema.required).toContain('id');
    });

    it('should correctly parse path parameters', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users/{userId}/posts/{postId}': {
            get: {
              operationId: 'getUserPost',
              parameters: [
                { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'postId', in: 'path', required: true, schema: { type: 'number' } },
              ],
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      const tool = tools[0];
      const schema = tool.inputSchema as unknown as StrictJsonSchema;

      expect(schema.properties).toHaveProperty('userId');
      expect(schema.properties).toHaveProperty('postId');
      expect(schema.required).toContain('userId');
      expect(schema.required).toContain('postId');
    });
  });
});
