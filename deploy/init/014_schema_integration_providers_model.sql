-- AI providers: optional model name (OpenAI-compatible chat/completions)

ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS model_name TEXT;

UPDATE integration_providers
SET display_name = 'OpenAI 兼容 LLM',
    model_name = COALESCE(model_name, 'llama3.1:8b')
WHERE slug = 'ollama';

UPDATE integration_providers
SET model_name = COALESCE(model_name, 'llama-3.1-8b-instant')
WHERE slug = 'groq';

UPDATE integration_providers
SET model_name = COALESCE(model_name, 'openrouter/free')
WHERE slug = 'openrouter';
