-- ============================================================
-- Migração: renomear "rack" para "deposito" na tabela enderecos
-- ============================================================
-- Rode isso uma vez no banco de produção (Railway → Postgres →
-- Data/Query), depois dos dois arquivos originais já aplicados.
-- Não apaga dados - só renomeia a coluna.
-- ============================================================

ALTER TABLE enderecos RENAME COLUMN rack TO deposito;
