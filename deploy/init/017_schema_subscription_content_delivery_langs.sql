-- Decouple RSS source languages (contentLangs) from email delivery language (deliveryLang).
-- Presets/subscriptions may ingest English (or any) sources while each user receives their preferred language.

UPDATE subscription_presets
SET rules_json = rules_json
  || jsonb_build_object(
    'contentLangs',
    COALESCE(
      rules_json->'contentLangs',
      CASE
        WHEN rules_json->>'lang' IS NOT NULL AND rules_json->>'lang' <> ''
        THEN jsonb_build_array(rules_json->>'lang')
        ELSE '["en"]'::jsonb
      END
    ),
    'deliveryLang',
    COALESCE(rules_json->>'deliveryLang', rules_json->>'lang', 'en')
  )
WHERE rules_json->'contentLangs' IS NULL
   OR jsonb_typeof(rules_json->'contentLangs') <> 'array'
   OR jsonb_array_length(COALESCE(rules_json->'contentLangs', '[]'::jsonb)) = 0;

-- Subscriptions: ensure contentLangs reflects preset/source, not conflated with delivery
UPDATE subscriptions s
SET rules_json = s.rules_json
  || jsonb_build_object(
    'contentLangs',
    COALESCE(
      p.rules_json->'contentLangs',
      s.rules_json->'contentLangs',
      CASE
        WHEN s.rules_json->>'lang' IS NOT NULL THEN jsonb_build_array(s.rules_json->>'lang')
        ELSE '["en"]'::jsonb
      END
    ),
    'deliveryLang',
    COALESCE(s.rules_json->>'deliveryLang', s.rules_json->>'lang', 'en')
  )
FROM subscription_presets p
WHERE s.preset_id = p.id
  AND (
    s.rules_json->'contentLangs' IS NULL
    OR jsonb_typeof(s.rules_json->'contentLangs') <> 'array'
  );
