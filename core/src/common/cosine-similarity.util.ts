// Cosine similarity thuần trên vector thô — SemanticToolIndex chỉ xếp hạng,
// KHÔNG trả điểm số, nên các nơi cần ngưỡng tin cậy thật (conversation-memory,
// policy-corpus) tự tính similarity từ vector.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
