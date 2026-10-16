export type StrictJsonValue =
  | string
  | number
  | boolean
  | null
  | StrictJsonArray
  | StrictJsonObject;

export interface StrictJsonObject {
  [key: string]: StrictJsonValue;
}

export interface StrictJsonArray extends Array<StrictJsonValue> {}

export interface McpContentPart {
  type: string;
  text?: string;
}

export const isError = (error: unknown): error is Error => {
  return error instanceof Error;
};
