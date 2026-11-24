import { Transform, TransformFnParams } from 'class-transformer';

export const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Decorator tự động cắt bỏ khoảng trắng thừa đầu/cuối của chuỗi trong DTO.
 */
export const Trim = () => Transform(trimString);
