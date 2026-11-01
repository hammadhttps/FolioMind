/**
 * Size of `document_chunks.embedding` (blueprint Section 12). The column type is
 * fixed by the migration, so JINA_EMBEDDING_DIMENSION must equal it; changing
 * the model's dimension means a new migration and re-embedding.
 */
export const INDEX_EMBEDDING_DIMENSION = 1024;
