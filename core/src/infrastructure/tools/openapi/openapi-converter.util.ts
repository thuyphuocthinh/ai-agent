import { OpenAPI, OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { McpToolDto } from '../../../contracts/dtos/mcp.dto';
import {
  iterateOperations,
  deriveToolName,
  DynamicToolDefinition,
} from 'agentic-openapi-parser';
import {
  buildStrictInputSchema,
  deriveMethodAnnotations,
} from 'agentic-openapi-parser/adapters/shared';

type AnyOperation = OpenAPIV3.OperationObject & Partial<OpenAPIV2.OperationObject>;

export class OpenApiConverter {
  /**
   * Converts a fully resolved OpenAPI document into a list of MCP Tools.
   *
   * Delegates the actual walk/name-derivation/strict-schema-sanitization to
   * agentic-openapi-parser (extracted from this exact class) — only the Swagger v2
   * `in: 'body'` parameter handling stays here since the library's `buildStrictInputSchema`
   * doesn't fold that case into `requestBody` on its own.
   *
   * @param document The dereferenced OpenAPI document.
   * @returns Array of McpToolDto.
   */
  static convertToMcpTools(document: OpenAPI.Document): McpToolDto[] {
    const tools: McpToolDto[] = [];
    const spec = document as unknown as Record<string, unknown>;

    for (const { path, method, operation } of iterateOperations(spec)) {
      const op = operation as unknown as AnyOperation;

      const name = deriveToolName(method, path, op.operationId);
      const description =
        op.summary || op.description || `Make a ${method.toUpperCase()} request to ${path}`;

      const { parameters, requestBodySchema, requestBodyRequired } = this.extractParamsAndBody(op);

      const toolDef: DynamicToolDefinition = {
        name,
        description,
        method,
        url: path,
        parameters,
        requestBodySchema,
        requestBodyRequired,
      };

      tools.push({
        name,
        description,
        inputSchema: buildStrictInputSchema(toolDef),
        annotations: deriveMethodAnnotations(method),
      });
    }

    return tools;
  }

  private static extractParamsAndBody(operation: AnyOperation): {
    parameters: Record<string, unknown>[];
    requestBodySchema?: Record<string, unknown>;
    requestBodyRequired?: boolean;
  } {
    const parameters: Record<string, unknown>[] = [];
    let requestBodySchema: Record<string, unknown> | undefined;
    let requestBodyRequired: boolean | undefined;

    if (operation.parameters) {
      for (const param of operation.parameters) {
        if ('in' in param && param.in === 'body') {
          // Swagger v2 body param: treat its schema as the requestBody
          const bodyParam = param as OpenAPIV2.InBodyParameterObject;
          requestBodySchema = bodyParam.schema as unknown as Record<string, unknown>;
          requestBodyRequired = bodyParam.required;
        } else {
          parameters.push(param as unknown as Record<string, unknown>);
        }
      }
    }

    if (operation.requestBody && 'content' in operation.requestBody) {
      const rb = operation.requestBody as OpenAPIV3.RequestBodyObject;
      requestBodyRequired = rb.required;
      // Prefer application/json; fall back to the first available content-type schema
      const jsonContent =
        rb.content['application/json'] || Object.values(rb.content)[0];
      if (jsonContent?.schema) {
        requestBodySchema = jsonContent.schema as unknown as Record<string, unknown>;
      }
    }

    return { parameters, requestBodySchema, requestBodyRequired };
  }
}
